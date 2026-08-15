/**
 * Route-level tests: mount the /news/* routes on a real loopback http server
 * and exercise them with fetch, mocking the network-facing modules so no
 * external requests are made.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsItem, NewsSource } from '../../src/shared/types'
import { createRouteCaches, makeRoutes } from '../../src/host/routes'
import { FetchError, SSRFError } from '../../src/host/fetcher'

vi.mock('../../src/host/rss', () => ({ fetchFeed: vi.fn() }))
vi.mock('../../src/host/article', () => ({ extractArticle: vi.fn() }))
vi.mock('../../src/host/image', () => ({ proxyImage: vi.fn() }))
// Route-level SSRF pre-checks resolve DNS — pin it to a public address so
// tests never touch the real resolver.
vi.mock('node:dns', () => ({
  lookup: vi.fn((_hostname: string, _options: unknown, callback: (err: Error | null, result?: unknown) => void) => {
    callback(null, [{ address: '93.184.216.34', family: 4 }])
  }),
}))

import { fetchFeed } from '../../src/host/rss'
import { extractArticle } from '../../src/host/article'
import { proxyImage } from '../../src/host/image'

const source: NewsSource = {
  id: 'src-1',
  name: 'Source One',
  url: 'https://feeds.example.com/rss.xml',
  category: 'world',
  language: 'en',
  builtin: true,
}

const item: NewsItem = {
  title: 'Item A',
  summary: 'Summary A',
  link: 'https://example.com/a',
  pubDate: '2025-08-13T10:00:00Z',
  source: { id: 'src-1', name: 'Source One', category: 'world' },
}

describe('/news routes', () => {
  let server: Server
  let base: string
  let cacheDir: string

  beforeEach(async () => {
    cacheDir = mkdtempSync(join(tmpdir(), 'dsh-news-routes-'))
    const caches = createRouteCaches(cacheDir)
    const routes = makeRoutes(caches)
    server = createServer((req, res) => {
      const route = routes.find((r) => r.path === (req.url ?? '').split('?')[0])
      if (route === undefined) {
        res.writeHead(404).end()
        return
      }
      void route.handler(req, res)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    base = `http://127.0.0.1:${address.port}`
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(cacheDir, { recursive: true, force: true })
  })

  describe('POST /news/feed', () => {
    it('aggregates items from multiple sources and fails one independently', async () => {
      vi.mocked(fetchFeed).mockResolvedValueOnce([item])
      vi.mocked(fetchFeed).mockRejectedValueOnce(new FetchError('TIMEOUT', 'source down'))

      const response = await fetch(`${base}/news/feed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sources: [
            source,
            { ...source, id: 'src-2', url: 'https://feeds2.example.com/rss.xml' },
          ],
        }),
      })
      expect(response.status).toBe(200)
      const body = await response.json() as { items: NewsItem[]; sources: Array<{ sourceId: string; error?: string }> }
      expect(body.items).toHaveLength(1)
      expect(body.items[0]?.link).toBe('https://example.com/a')
      const src2 = body.sources.find((s) => s.sourceId === 'src-2')
      expect(src2?.error).toContain('source down')
      const src1 = body.sources.find((s) => s.sourceId === 'src-1')
      expect(src1?.error).toBeUndefined()
    })

    it('serves cached items on the second request (same TTL window)', async () => {
      vi.mocked(fetchFeed).mockResolvedValueOnce([item])
      const payload = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: [source] }),
      }
      const first = await fetch(`${base}/news/feed`, payload)
      expect(first.status).toBe(200)
      const second = await fetch(`${base}/news/feed`, payload)
      expect(second.status).toBe(200)
      expect(vi.mocked(fetchFeed)).toHaveBeenCalledTimes(1)
    })

    it('rejects invalid categories', async () => {
      const response = await fetch(`${base}/news/feed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: [{ ...source, category: 'sports' }] }),
      })
      expect(response.status).toBe(400)
    })

    it('rejects non-http source urls', async () => {
      const response = await fetch(`${base}/news/feed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: [{ ...source, url: 'file:///etc/passwd' }] }),
      })
      expect(response.status).toBe(400)
    })

    it('rejects missing source fields and empty bodies', async () => {
      const bad = await fetch(`${base}/news/feed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources: [{ id: 'x' }] }),
      })
      expect(bad.status).toBe(400)
      const empty = await fetch(`${base}/news/feed`, { method: 'POST' })
      expect(empty.status).toBe(400)
    })

    it('rejects non-POST methods', async () => {
      const response = await fetch(`${base}/news/feed`)
      expect(response.status).toBe(405)
    })
  })

  describe('GET /news/article', () => {
    it('extracts and caches an article', async () => {
      vi.mocked(extractArticle).mockResolvedValueOnce({
        title: 'Extracted Title',
        contentHtml: '<p>Hello</p>',
        link: 'https://example.com/a',
      })
      const url = `${base}/news/article?u=${encodeURIComponent('https://example.com/a')}`
      const first = await fetch(url)
      expect(first.status).toBe(200)
      const body = await first.json() as { title: string; contentHtml: string; cached: boolean }
      expect(body.title).toBe('Extracted Title')
      expect(body.contentHtml).toBe('<p>Hello</p>')
      const second = await fetch(url)
      const body2 = await second.json() as { cached: boolean }
      expect(body2.cached).toBe(true)
      expect(vi.mocked(extractArticle)).toHaveBeenCalledTimes(1)
    })

    it('rejects SSRF targets', async () => {
      const url = `${base}/news/article?u=${encodeURIComponent('http://127.0.0.1/x')}`
      const response = await fetch(url)
      expect(response.status).toBe(400)
    })

    it('reports extraction failures as 502', async () => {
      vi.mocked(extractArticle).mockRejectedValueOnce(new FetchError('EMPTY', 'no article'))
      const url = `${base}/news/article?u=${encodeURIComponent('https://example.com/nope')}`
      const response = await fetch(url)
      expect(response.status).toBe(502)
    })

    it('rejects missing u parameter', async () => {
      const response = await fetch(`${base}/news/article`)
      expect(response.status).toBe(400)
    })
  })

  describe('GET /news/img', () => {
    it('proxies and caches an image', async () => {
      vi.mocked(proxyImage).mockResolvedValueOnce({ body: Buffer.from([1, 2, 3]), contentType: 'image/png' })
      const url = `${base}/news/img?u=${encodeURIComponent('https://example.com/p.png')}`
      const first = await fetch(url)
      expect(first.status).toBe(200)
      expect(first.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await first.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
      const second = await fetch(url)
      expect(second.status).toBe(200)
      expect(vi.mocked(proxyImage)).toHaveBeenCalledTimes(1)
    })

    it('rejects SSRF image targets', async () => {
      const url = `${base}/news/img?u=${encodeURIComponent('http://192.168.1.1/x.png')}`
      const response = await fetch(url)
      expect(response.status).toBe(400)
    })
  })

  it('SSRF errors surface as 400 for feed sources too', async () => {
    vi.mocked(fetchFeed).mockRejectedValueOnce(new SSRFError('blocked'))
    const response = await fetch(`${base}/news/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [source] }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { sources: Array<{ error?: string }> }
    expect(body.sources[0]?.error).toContain('blocked')
  })
})
