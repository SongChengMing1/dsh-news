/**
 * Image proxy: fetch a remote image through the SSRF-guarded fetcher with
 * the source site as Referer (anti-hotlink), and return the bytes with the
 * remote content-type.
 */
import { fetchWithRetry, globalLimiter } from './fetcher.ts'

/** Max proxied image size (20 MiB). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Only these content types may pass through the proxy. */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
])

export interface ProxiedImage {
  body: Buffer
  contentType: string
}

/**
 * Fetch an image with hotlink headers.
 * @param url - validated image URL.
 * @param referer - the page that embeds the image (source site origin).
 */
export async function proxyImage(url: URL, referer: string): Promise<ProxiedImage> {
  const fetched = await globalLimiter.run(() => fetchWithRetry(url, {
    maxBytes: MAX_IMAGE_BYTES,
    referer,
    headers: {
      accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
    },
  }))
  if (fetched.status !== 200) {
    throw new Error(`image fetch failed with status ${fetched.status}`)
  }
  const raw = typeof fetched.headers['content-type'] === 'string'
    ? fetched.headers['content-type'].split(';')[0]!.trim().toLowerCase()
    : ''
  const contentType = ALLOWED_IMAGE_TYPES.has(raw) ? raw : 'image/jpeg'
  return { body: fetched.body, contentType }
}
