/**
 * SSRF guard for outbound news fetches.
 *
 * Strategy:
 * 1. Scheme check — only `http:` / `https:` URLs are fetchable.
 * 2. Hostname check — reject literal IPs in private/reserved ranges,
 *    `.local` / `.localhost` TLDs, and empty hostnames.
 * 3. DNS re-check — resolve every A/AAAA record for the hostname and reject
 *    the URL when any record lands in a private/reserved range.
 * 4. Bind-time pinning — the fetcher connects through a `lookup` callback
 *    that only ever returns the pre-validated public IPs, closing the
 *    TOCTOU window between validation and connection.
 *
 * Redirects are re-validated hop by hop by the fetcher (see fetcher.ts).
 */
import { lookup as dnsLookup } from 'node:dns'
import net from 'node:net'

/** Error type thrown by the guard. */
export class SSRFError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSRFError'
  }
}

/** Hostname labels never fetchable regardless of resolution. */
const BLOCKED_TLDS = new Set(['local', 'localhost', 'internal', 'intranet', 'home', 'lan'])
/** Hostnames that resolve to nothing meaningful — always reject. */
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal'])

/** IPv4 private/reserved ranges, as [start, end] uint32 pairs. */
const PRIVATE_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 (this network)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 (private)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 (private)
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (documentation)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 (private)
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmark)
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (documentation)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (documentation)
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 (reserved, incl. broadcast)
] as const

/** IPv6 ranges to reject, as [start, end] bigints of the 128-bit address. */
const PRIVATE_V6: ReadonlyArray<readonly [bigint, bigint]> = [
  // ::/128, ::1/128 (unspecified, loopback)
  [0n, 1n],
  // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (site-local, deprecated)
  [0xfc000000000000000000000000000000n, 0xfdffffffffffffffffffffffffffffffn],
  [0xfe800000000000000000000000000000n, 0xfebfffffffffffffffffffffffffffffn],
  [0xfec00000000000000000000000000000n, 0xfeffffffffffffffffffffffffffffffn],
  // ff00::/8 (multicast)
  [0xff000000000000000000000000000000n, 0xffffffffffffffffffffffffffffffffn],
  // 64:ff9b::/96 (NAT64) and 2001:db8::/32 (documentation) — commonly used for
  // IPv4-mapped attacks / docs.
  [0x0064ff9b000000000000000000000000n, 0x0064ff9b0000000000000000ffffffffn],
  [0x20010db8000000000000000000000000n, 0x20010db8ffffffffffffffffffffffffn],
] as const

/** Convert an IPv4 string to its uint32 representation (null when not v4). */
function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = (value << 8) | n
  }
  return value >>> 0
}

/** Convert an IPv6 string to its bigint representation (null when not v6). */
function ipv6ToBigInt(ip: string): bigint | null {
  const clean = ip.split('%')[0] ?? ip
  if (!net.isIPv6(clean)) return null
  const lower = clean.toLowerCase()
  // Split on :: (at most one occurrence; net.isIPv6 guarantees the form).
  const [leftPart, rightPart] = lower.split('::')
  const parseGroups = (part: string | undefined): string[] => {
    if (part === undefined || part === '') return []
    const segments = part.split(':')
    const groups: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] ?? ''
      // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4): two hextets.
      if (segment.includes('.')) {
        const octets = segment.split('.')
        if (octets.length !== 4) return []
        const ok = octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
        if (!ok) return []
        const [a, b, c, d] = octets.map((o) => Number(o))
        groups.push(((a! << 8) | b!).toString(16).padStart(4, '0'))
        groups.push(((c! << 8) | d!).toString(16).padStart(4, '0'))
      } else {
        groups.push(segment.padStart(4, '0'))
      }
    }
    return groups
  }
  const left = parseGroups(leftPart)
  const right = parseGroups(rightPart)
  const emptyCount = 8 - left.length - right.length
  if (emptyCount < 0) return null
  const all = [...left, ...Array.from({ length: emptyCount }, () => '0000'), ...right]
  if (all.length !== 8) return null
  return BigInt('0x' + all.join(''))
}

/** Is this IP string a private/reserved address? */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const value = ipv4ToUint32(ip)
    if (value === null) return true
    return PRIVATE_V4.some(([start, end]) => value >= start && value <= end)
  }
  if (net.isIPv6(ip)) {
    const value = ipv6ToBigInt(ip)
    if (value === null) return true
    return PRIVATE_V6.some(([start, end]) => value >= start && value <= end)
  }
  // Not a parseable IP at all — treat as unsafe for the IP-level checks.
  return true
}

/** Validate the scheme and hostname form of a URL (no DNS involved). */
export function assertSafeUrlShape(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SSRFError(`scheme not allowed: ${url.protocol}`)
  }
  const host = url.hostname
  if (host === '') {
    throw new SSRFError('empty hostname')
  }
  // Literal IPs must pass the range check directly (no DNS needed).
  if (net.isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      throw new SSRFError(`blocked private/reserved IP: ${host}`)
    }
    return
  }
  const lower = host.toLowerCase()
  if (BLOCKED_HOSTS.has(lower)) {
    throw new SSRFError(`blocked hostname: ${host}`)
  }
  const labels = lower.split('.')
  const tld = labels[labels.length - 1] ?? ''
  if (BLOCKED_TLDS.has(tld)) {
    throw new SSRFError(`blocked hostname TLD: ${host}`)
  }
  if (labels.length < 2) {
    throw new SSRFError(`single-label hostname not allowed: ${host}`)
  }
}

/** Resolve every A/AAAA record for a hostname (rejects on DNS failure). */
export async function resolveHostIps(hostname: string): Promise<string[]> {
  const results = await new Promise<string[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err !== null) {
        reject(new SSRFError(`DNS lookup failed for ${hostname}: ${err.code ?? err.message}`))
        return
      }
      resolve(addresses.map((a) => a.address))
    })
  })
  if (results.length === 0) {
    throw new SSRFError(`no addresses for ${hostname}`)
  }
  return results
}

/**
 * Full URL validation: shape + DNS resolution + IP range check.
 * @returns the validated public IPs for the URL's hostname.
 * @throws SSRFError when the URL is not fetchable.
 */
export async function assertSafeUrl(url: URL): Promise<string[]> {
  assertSafeUrlShape(url)
  if (net.isIP(url.hostname) !== 0) {
    // Literal IP: already range-checked in the shape step.
    return [url.hostname]
  }
  const ips = await resolveHostIps(url.hostname)
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new SSRFError(`resolved to private/reserved IP: ${url.hostname} -> ${ip}`)
    }
  }
  return ips
}
