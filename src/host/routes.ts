/**
 * The /news/* route family: feed aggregation, article extraction, image
 * proxy. Every route carries a loopback-only trust fence (plus browser
 * same-origin markers) — mirroring the dsh-ssh route conventions — and
 * validates all parameters through schemastery schemas.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ArticleResponse, FeedResponse, NewsItem, NewsSource } from '../shared/types.ts'
import { isNewsCategory } from '../shared/types.ts'
import { DiskCache, MemoryCache } from './cache.ts'
import { FetchError, SSRFError } from './fetcher.ts'
import { assertSafeUrl } from './guard.ts'
import { extractArticle } from './article.ts'
import { proxyImage } from './image.ts'
import { fetchFeed } from './rss.ts'

/** Cache TTLs (ms). */
export const FEED_TTL = 15 * 60 * 1000
export const ARTICLE_TTL = 24 * 60 * 60 * 1000
export const IMG_TTL = 7 * 24 * 60 * 60 * 1000

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Source entry submitted by the Client (per-request source list). */
const SourceSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(128),
  url: z.string().max(2048),
  category: z.string().max(16),
  language: z.string().max(8),
  favicon: z.string().max(2048),
  builtin: z.boolean(),
})

const FeedBodySchema = z.object({
  sources: z.array(SourceSchema).min(1).max(64),
  ttlMinutes: z.number().min(1).max(1440),
  imageProxy: z.boolean(),
})

/** Caches shared by all routes. */
export interface RouteCaches {
  feedMem: MemoryCache<NewsItem[]>
  feedDisk: DiskCache
  articleMem: MemoryCache<ArticleResponse>
  articleDisk: DiskCache
  imgMem: MemoryCache<Buffer>
  imgDisk: DiskCache
}

/** Build the cache trio rooted at a cache directory. */
export function createRouteCaches(cacheDir: string): RouteCaches {
  return {
    feedMem: new MemoryCache<NewsItem[]>(500),
    feedDisk: new DiskCache(join(cacheDir, 'feeds')),
    articleMem: new MemoryCache<ArticleResponse>(500),
    articleDisk: new DiskCache(join(cacheDir, 'articles')),
    imgMem: new MemoryCache<Buffer>(500),
    imgDisk: new DiskCache(join(cacheDir, 'imgs')),
  }
}

/** Is the request from a loopback connection with a same-origin browser marker? */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Validate a source list from the request body. */
function validateSources(body: unknown): NewsSource[] {
  const parsed = FeedBodySchema(body as never) as { sources: NewsSource[]; ttlMinutes?: number }
  if (parsed.sources.length === 0) {
    throw new Error('at least one source is required')
  }
  for (const source of parsed.sources) {
    if (source.id === '' || source.name === '' || source.url === '' || source.language === '') {
      throw new Error('source fields (id/name/url/category/language) are required')
    }
    if (!isNewsCategory(source.category)) {
      throw new Error(`invalid category: ${source.category}`)
    }
    let candidate: URL
    try {
      candidate = new URL(source.url)
    } catch {
      throw new Error(`invalid source url: ${source.url}`)
    }
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') {
      throw new Error(`invalid source url scheme: ${source.url}`)
    }
  }
  return parsed.sources
}

/** Validate a fetch URL query param (u=). */
function validateTargetUrl(value: string | undefined, label: string): URL {
  if (value === undefined || value === '') {
    throw new Error(`${label} parameter missing`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must be http(s)`)
  }
  return url
}

/**
 * Build every /news route.
 * @param caches - the cache trio.
 * @param imageProxyPrefix - prefix the Host rewrites image URLs through
 * (served same-origin, so a relative path works in the browser).
 */
export function makeRoutes(caches: RouteCaches, imageProxyPrefix = '/news/img?u='): WebRoute[] {
  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method ?? ''}` })
      return false
    }
    return true
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: '/news/feed',
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        let sources: NewsSource[]
        let ttlMinutes = 15
        let imageProxy = true
        try {
          const parsed = FeedBodySchema(body as never) as { sources: NewsSource[]; ttlMinutes?: number; imageProxy?: boolean }
          sources = validateSources(body)
          ttlMinutes = parsed.ttlMinutes ?? 15
          imageProxy = parsed.imageProxy ?? true
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid body' })
          return
        }
        const ttlMs = ttlMinutes * 60 * 1000
        const now = Date.now()

        const results: FeedResponse['sources'] = []
        const items: NewsItem[] = []

        await Promise.all(sources.map(async (source) => {
          const key = `feed:${source.url}`
          try {
            // Memory cache first, then disk. TTL = min(default, requested).
            let cached: NewsItem[] | undefined = caches.feedMem.get(key)
            if (cached === undefined) {
              const disk = caches.feedDisk.read(key)
              if (disk !== undefined) {
                cached = JSON.parse(disk.value.toString('utf8')) as NewsItem[]
              }
            }
            if (cached !== undefined) {
              items.push(...cached)
              results.push({ sourceId: source.id, fetchedAt: new Date(now).toISOString() })
              return
            }
            const fetched = await fetchFeed(source, imageProxy ? imageProxyPrefix : undefined)
            // Cache with the route TTL, but honor a smaller client TTL.
            const expiresAt = now + Math.min(FEED_TTL, ttlMs)
            caches.feedMem.set(key, fetched, expiresAt)
            caches.feedDisk.write(key, Buffer.from(JSON.stringify(fetched), 'utf8'), expiresAt)
            items.push(...fetched)
            results.push({ sourceId: source.id, fetchedAt: new Date(now).toISOString() })
          } catch (error) {
            results.push({
              sourceId: source.id,
              fetchedAt: new Date(now).toISOString(),
              error: error instanceof Error ? error.message : 'unknown error',
            })
          }
        }))

        // Newest first across all sources.
        items.sort((a, b) => {
          const ta = a.pubDate === undefined ? 0 : Date.parse(a.pubDate)
          const tb = b.pubDate === undefined ? 0 : Date.parse(b.pubDate)
          return tb - ta
        })

        writeJson(res, 200, {
          items,
          sources: results,
          fetchedAt: new Date(now).toISOString(),
          cached: false,
        } satisfies FeedResponse)
      },
    },
    {
      kind: 'exact',
      path: '/news/article',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        let target: URL
        try {
          target = validateTargetUrl(queryParam(requestUrl, 'u'), 'u')
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid query' })
          return
        }
        const key = `article:${target.toString()}`
        try {
          // SSRF gate before any fetch or cache write.
          await assertSafeUrl(target)
          let cached = caches.articleMem.get(key)
          if (cached === undefined) {
            const disk = caches.articleDisk.read(key)
            if (disk !== undefined) {
              cached = JSON.parse(disk.value.toString('utf8')) as ArticleResponse
            }
          }
          if (cached !== undefined) {
            writeJson(res, 200, { ...cached, cached: true })
            return
          }
          const extracted = await extractArticle(target, imageProxyPrefix, target.toString())
          const response: ArticleResponse = {
            url: target.toString(),
            title: extracted.title,
            contentHtml: extracted.contentHtml,
            link: extracted.link,
            cached: false,
          }
          const expiresAt = Date.now() + ARTICLE_TTL
          caches.articleMem.set(key, response, expiresAt)
          caches.articleDisk.write(key, Buffer.from(JSON.stringify(response), 'utf8'), expiresAt)
          writeJson(res, 200, response)
        } catch (error) {
          if (error instanceof SSRFError) {
            writeJson(res, 400, { error: error.message })
          } else if (error instanceof FetchError) {
            writeJson(res, 502, { error: error.message })
          } else {
            writeJson(res, 500, { error: error instanceof Error ? error.message : 'extraction failed' })
          }
        }
      },
    },
    {
      kind: 'exact',
      path: '/news/img',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        let target: URL
        try {
          target = validateTargetUrl(queryParam(requestUrl, 'u'), 'u')
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : 'invalid query' })
          return
        }
        const key = `img:${target.toString()}`
        try {
          // SSRF gate before any fetch or cache write.
          await assertSafeUrl(target)
          let cached = caches.imgMem.get(key)
          let contentType: string | undefined
          if (cached === undefined) {
            const disk = caches.imgDisk.read(key)
            if (disk !== undefined) {
              cached = disk.value
              contentType = disk.contentType
            }
          }
          if (cached !== undefined) {
            res.writeHead(200, {
              'content-type': contentType ?? 'image/jpeg',
              'cache-control': `public, max-age=${Math.floor(IMG_TTL / 1000)}`,
              'referrer-policy': 'no-referrer',
            })
            res.end(cached)
            return
          }
          const proxied = await proxyImage(target, `${target.protocol}//${target.host}/`)
          const expiresAt = Date.now() + IMG_TTL
          caches.imgMem.set(key, proxied.body, expiresAt)
          caches.imgDisk.write(key, proxied.body, expiresAt, proxied.contentType)
          res.writeHead(200, {
            'content-type': proxied.contentType,
            'cache-control': `public, max-age=${Math.floor(IMG_TTL / 1000)}`,
            'referrer-policy': 'no-referrer',
          })
          res.end(proxied.body)
        } catch (error) {
          if (error instanceof SSRFError) {
            writeJson(res, 400, { error: error.message })
          } else {
            writeJson(res, 502, { error: error instanceof Error ? error.message : 'image fetch failed' })
          }
        }
      },
    },
  ]
  return routes
}
