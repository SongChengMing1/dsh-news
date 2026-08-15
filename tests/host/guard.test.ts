import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { assertSafeUrl, assertSafeUrlShape, isPrivateIp, resolveHostIps, SSRFError } from '../../src/host/guard'

/** Mock node:dns.lookup for every test in this file. */
vi.mock('node:dns', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns'

const mockLookup = vi.mocked(lookup)

function setLookup(addresses: Array<{ address: string; family: number }> | null): void {
  // node:dns lookup has several overloads; the mock implementation casts
  // through the callable form the guard uses.
  mockLookup.mockImplementation(((_hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, result?: unknown) => void) => {
    if (addresses === null) {
      const err = new Error('ENOTFOUND') as NodeJS.ErrnoException
      err.code = 'ENOTFOUND'
      callback(err)
      return
    }
    callback(null, addresses)
  }) as never)
}

describe('isPrivateIp', () => {
  it('flags loopback, private and reserved IPv4 ranges', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('172.31.255.255')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('169.254.169.254')).toBe(true) // cloud metadata
    expect(isPrivateIp('100.64.0.1')).toBe(true) // CGNAT
    expect(isPrivateIp('0.0.0.0')).toBe(true)
    expect(isPrivateIp('255.255.255.255')).toBe(true)
    expect(isPrivateIp('224.0.0.1')).toBe(true) // multicast
    expect(isPrivateIp('192.0.2.1')).toBe(true) // documentation
    expect(isPrivateIp('198.51.100.1')).toBe(true)
    expect(isPrivateIp('203.0.113.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('93.184.216.34')).toBe(false)
  })

  it('flags loopback, ULA and link-local IPv6', () => {
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('::')).toBe(true)
    expect(isPrivateIp('fc00::1')).toBe(true)
    expect(isPrivateIp('fd12:3456::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('ff02::1')).toBe(true) // multicast
    expect(isPrivateIp('64:ff9b::8.8.8.8')).toBe(true) // NAT64
    expect(isPrivateIp('2001:db8::1')).toBe(true) // documentation
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
  })
})

describe('assertSafeUrlShape', () => {
  it('rejects non-http(s) schemes', () => {
    expect(() => assertSafeUrlShape(new URL('ftp://example.com/x'))).toThrow(SSRFError)
    expect(() => assertSafeUrlShape(new URL('file:///etc/passwd'))).toThrow(SSRFError)
    expect(() => assertSafeUrlShape(new URL('data:text/plain,hi'))).toThrow(SSRFError)
  })

  it('rejects literal private IPs', () => {
    expect(() => assertSafeUrlShape(new URL('http://127.0.0.1/'))).toThrow(/private|reserved/)
    expect(() => assertSafeUrlShape(new URL('http://10.1.2.3/'))).toThrow(SSRFError)
    expect(() => assertSafeUrlShape(new URL('http://192.168.0.1/'))).toThrow(SSRFError)
    expect(() => assertSafeUrlShape(new URL('http://169.254.169.254/latest/meta-data/'))).toThrow(SSRFError)
    expect(() => assertSafeUrlShape(new URL('http://[::1]/'))).toThrow(SSRFError)
  })

  it('allows literal public IPs', () => {
    expect(() => assertSafeUrlShape(new URL('http://8.8.8.8/'))).not.toThrow()
    expect(() => assertSafeUrlShape(new URL('https://1.1.1.1/'))).not.toThrow()
  })

  it('rejects .local, .localhost, single-label and blocked hostnames', () => {
    expect(() => assertSafeUrlShape(new URL('http://printer.local/'))).toThrow(/TLD/)
    expect(() => assertSafeUrlShape(new URL('http://foo.localhost/'))).toThrow(/TLD/)
    expect(() => assertSafeUrlShape(new URL('http://localhost/'))).toThrow(/blocked hostname/)
    expect(() => assertSafeUrlShape(new URL('http://internal/'))).toThrow(/TLD/)
    expect(() => assertSafeUrlShape(new URL('http://hostname/'))).toThrow(/single-label/)
  })

  it('allows ordinary hostnames', () => {
    expect(() => assertSafeUrlShape(new URL('https://www.example.com/feed'))).not.toThrow()
    expect(() => assertSafeUrlShape(new URL('https://feeds.bbci.co.uk/news/rss.xml'))).not.toThrow()
  })
})

describe('resolveHostIps / assertSafeUrl', () => {
  beforeEach(() => { mockLookup.mockReset() })
  afterEach(() => { vi.restoreAllMocks() })

  it('resolves DNS and rejects hostnames landing on private IPs', async () => {
    setLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    await expect(assertSafeUrl(new URL('http://evil.example.com/'))).rejects.toThrow(/resolved to private/)
  })

  it('returns validated public IPs', async () => {
    setLookup([{ address: '93.184.216.34', family: 4 }])
    const ips = await assertSafeUrl(new URL('http://good.example.com/'))
    expect(ips).toEqual(['93.184.216.34'])
  })

  it('rejects DNS failures', async () => {
    setLookup(null)
    await expect(assertSafeUrl(new URL('http://nx.example.com/'))).rejects.toThrow(SSRFError)
  })

  it('rejects when DNS returns no addresses', async () => {
    setLookup([])
    await expect(assertSafeUrl(new URL('http://empty.example.com/'))).rejects.toThrow(/no addresses/)
  })

  it('skips DNS for literal IPs', async () => {
    const ips = await assertSafeUrl(new URL('http://8.8.8.8/'))
    expect(ips).toEqual(['8.8.8.8'])
    expect(mockLookup).not.toHaveBeenCalled()
  })
})
