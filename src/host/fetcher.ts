/**
 * Outbound HTTP fetcher with SSRF pinning, timeouts, redirect re-validation,
 * size caps and a shared concurrency limiter.
 *
 * Every connection goes through a `lookup` callback that only returns the
 * pre-validated public IPs (see guard.ts), so even a DNS rebinding race
 * cannot reach private ranges. Redirects are followed manually and each hop
 * is re-validated by the guard.
 */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import { SSRFError, assertSafeUrl, isPrivateIp } from './guard.ts'

export { SSRFError } from './guard.ts'

/** Generic fetch error (timeout / too large / network). */
export class FetchError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'FetchError'
    this.code = code
  }
}

/** Result of one validated fetch. */
export interface Fetched {
  /** Final URL after redirects (the validated target). */
  url: string
  status: number
  /** Lowercased response headers. */
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

export interface FetchOptions {
  /** Per-request timeout in ms (default 12000). */
  timeoutMs?: number
  /** Max response body bytes (default 10 MiB). */
  maxBytes?: number
  /** Extra headers. */
  headers?: Record<string, string>
  /** Max redirect hops (default 3). */
  maxRedirects?: number
  /** Base URL for the Referer header (image proxy). */
  referer?: string
}

const DEFAULT_UA = 'dsh-news/0.1 (+https://github.com/wilond/dsh-news)'

/**
 * Concurrency limiter (semaphore). Shared by all news fetches.
 * @param limit - maximum concurrent acquisitions.
 */
export class Limiter {
  private active = 0
  private readonly queue: Array<() => void> = []
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => { this.queue.push(resolve) })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next !== undefined) {
      next()
      return
    }
    this.active--
  }
}

/** The shared global limiter (concurrency 4, per 总体方案 §7.3). */
export const globalLimiter = new Limiter(4)

/**
 * Pick the HTTP(S) proxy for a target URL from the environment, honoring
 * no_proxy. Returns undefined for direct connections.
 */
export function proxyFor(url: URL): { host: string; port: number } | undefined {
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy
  if (noProxy !== undefined) {
    const host = url.hostname.toLowerCase()
    const patterns = noProxy.split(',').map((p) => p.trim().toLowerCase()).filter((p) => p !== '')
    for (const pattern of patterns) {
      if (pattern === '*') return undefined
      const match = pattern.startsWith('.') ? host.endsWith(pattern) : host === pattern || host.endsWith(`.${pattern}`)
      if (match) return undefined
    }
  }
  const raw = url.protocol === 'https:' ? (process.env.HTTPS_PROXY ?? process.env.https_proxy) : (process.env.HTTP_PROXY ?? process.env.http_proxy)
  if (raw === undefined || raw === '') return undefined
  try {
    const proxyUrl = new URL(raw)
    const port = proxyUrl.port === '' ? (proxyUrl.protocol === 'https:' ? 443 : 80) : Number(proxyUrl.port)
    return { host: proxyUrl.hostname, port }
  } catch {
    return undefined
  }
}

/** Open a CONNECT tunnel through the proxy to the target host:port. */
function connectTunnel(proxy: { host: string; port: number }, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port, timeout: timeoutMs })
    socket.once('connect', () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`)
    })
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      socket.removeListener('data', onData)
      const statusLine = buffer.subarray(0, headerEnd).toString('utf8').split('\r\n')[0] ?? ''
      const status = Number(statusLine.split(' ')[1] ?? 0)
      if (status >= 200 && status < 300) {
        // Hand the remaining bytes back to the TLS/http layer.
        socket.unshift(buffer.subarray(headerEnd + 4))
        resolve(socket)
      } else {
        socket.destroy()
        reject(new FetchError('PROXY', `proxy CONNECT failed: ${statusLine}`))
      }
    }
    socket.on('data', onData)
    socket.once('error', (err) => {
      reject(err instanceof FetchError ? err : new FetchError('NETWORK', `proxy connect failed: ${err.message}`))
    })
    socket.once('timeout', () => {
      socket.destroy(new FetchError('TIMEOUT', `proxy timeout after ${timeoutMs}ms`))
    })
  })
}

/** One validated request (no redirects). Connects to the pre-validated public IP. */
async function requestOnce(
  url: URL,
  verifiedIp: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBytes: number,
): Promise<Fetched> {
  const proxy = proxyFor(url)
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  const mod = url.protocol === 'https:' ? https : http

  // Either a direct request to the verified IP, or (when a proxy is
  // configured) a request through the proxy tunnel. In the proxy case the
  // CONNECT target is the verified IP:port, so the SSRF pinning holds.
  const options: https.RequestOptions = {
    hostname: verifiedIp,
    port,
    servername: url.protocol === 'https:' ? url.hostname : undefined,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: { ...headers, host: url.host },
    timeout: timeoutMs,
  }
  if (proxy !== undefined) {
    if (url.protocol === 'https:') {
      options.createConnection = (_o, oncreate) => {
        connectTunnel(proxy, verifiedIp, port, timeoutMs)
          .then((socket) => {
            oncreate(null, tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true }))
          })
          .catch((err) => { oncreate(err as Error, undefined as never) })
        return undefined
      }
    } else {
      // Plain http over a proxy: absolute-form request line to the proxy.
      options.hostname = proxy.host
      options.port = proxy.port
      options.path = url.toString()
      options.headers = { ...headers, host: url.host }
    }
  }

  return await new Promise<Fetched>((resolve, reject) => {
    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          req.destroy(new FetchError('TOO_LARGE', `response exceeds ${maxBytes} bytes`))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        resolve({
          url: url.toString(),
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
      res.on('error', (err) => { reject(err) })
    })
    req.on('timeout', () => {
      req.destroy(new FetchError('TIMEOUT', `timeout after ${timeoutMs}ms`))
    })
    req.on('error', (err) => {
      if (err instanceof FetchError) {
        reject(err)
      } else if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        reject(new FetchError('TIMEOUT', `timeout after ${timeoutMs}ms`))
      } else {
        reject(new FetchError('NETWORK', err.message))
      }
    })
    req.end()
  })
}

/**
 * Fetch a URL with full validation: shape + DNS checks per hop, size caps,
 * timeout, and a bounded redirect chain.
 * @param url - the URL to fetch.
 * @param options - timeout/headers/size options.
 * @returns the final response.
 * @throws SSRFError for unsafe URLs; FetchError for network/timeout/size.
 */
export async function fetchValidated(url: URL, options: FetchOptions = {}): Promise<Fetched> {
  const timeoutMs = options.timeoutMs ?? 12000
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024
  const maxRedirects = options.maxRedirects ?? 3
  const headers: Record<string, string> = {
    'user-agent': DEFAULT_UA,
    accept: '*/*',
    ...options.headers,
  }
  if (options.referer !== undefined) {
    headers.referer = options.referer
  }

  let current = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // Validate this hop's URL shape + DNS and get the pinned IPs.
    const ips = await assertSafeUrl(current)
    // Try each verified IP in turn (a CDN can resolve to one dead + one live).
    let lastError: unknown
    let response: Fetched | undefined
    for (const ip of ips) {
      try {
        response = await requestOnce(current, ip, headers, timeoutMs, maxBytes)
        break
      } catch (error) {
        lastError = error
        if (error instanceof SSRFError) throw error
      }
    }
    if (response === undefined) {
      throw lastError instanceof Error ? lastError : new FetchError('NETWORK', 'all addresses failed')
    }
    const status = response.status
    const location = response.headers.location
    if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
      const next = new URL(location, current)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new FetchError('REDIRECT', `redirect to unsupported scheme: ${next.protocol}`)
      }
      current = next
      continue
    }
    return response
  }
  throw new FetchError('REDIRECT', `too many redirects (${maxRedirects})`)
}

/** Convenience: fetch with exactly one retry on network/timeout errors. */
export async function fetchWithRetry(url: URL, options: FetchOptions = {}): Promise<Fetched> {
  try {
    return await fetchValidated(url, options)
  } catch (error) {
    // SSRF and size errors are deterministic — never retry them.
    if (error instanceof SSRFError || (error instanceof FetchError && error.code === 'TOO_LARGE')) {
      throw error
    }
    return await fetchValidated(url, options)
  }
}
