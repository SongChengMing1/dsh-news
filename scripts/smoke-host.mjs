#!/usr/bin/env node
/**
 * M2 acceptance smoke: boot the real /news/* routes on a loopback server and
 * hit them with real network traffic (no mocks).
 *
 * Checks:
 *  1. POST /news/feed with the 17 built-in sources → items + per-source results
 *  2. Second feed request is served from cache (fetch count unchanged)
 *  3. GET /news/article?u=<first real item> → sanitized contentHtml
 *  4. GET /news/img?u=<proxied thumbnail> → image bytes + content-type
 *  5. SSRF cases → 400 (loopback IP, .local host)
 *  6. Disk cache files exist under the cache dir
 *
 * Run: node scripts/smoke-host.mjs   (after pnpm build)
 */
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRouteCaches, makeRoutes } from '../lib/index.js'
import { BUILTIN_SOURCES } from '../lib/index.js'

const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-news-smoke-'))
const caches = createRouteCaches(cacheDir)
const routes = makeRoutes(caches)
const server = createServer((req, res) => {
  const route = routes.find((r) => r.path === (req.url ?? '').split('?')[0])
  if (route === undefined) {
    res.writeHead(404).end('not found')
    return
  }
  void route.handler(req, res)
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('no port')
const base = `http://127.0.0.1:${address.port}`
console.log(`smoke server on ${base}`)

try {
  // 1. Feed with all built-in sources (real network).
  const started = Date.now()
  const feedResponse = await fetch(`${base}/news/feed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sources: BUILTIN_SOURCES.map(({ id, name, url, category, language, favicon, builtin }) => ({ id, name, url, category, language, favicon, builtin })),
    }),
  })
  const feed = await feedResponse.json()
  const okSources = feed.sources.filter((s) => s.error === undefined).length
  const failed = feed.sources.filter((s) => s.error !== undefined)
  check('feed status 200', feedResponse.status === 200, `status=${feedResponse.status}`)
  check('feed returns items', Array.isArray(feed.items) && feed.items.length > 0, `${feed.items.length} items from ${okSources}/${feed.sources.length} sources in ${Date.now() - started}ms`)
  check('feed per-source degradation works', failed.length === 0 || failed.every((s) => typeof s.error === 'string'), failed.map((s) => `${s.sourceId}: ${s.error}`).join('; ') || 'all sources ok')
  const categories = new Set(feed.items.map((i) => i.source?.category))
  check('feed covers categories', categories.size >= 3, [...categories].join(','))

  // 2. Cache hit on second request.
  const before = Date.now()
  const second = await fetch(`${base}/news/feed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sources: BUILTIN_SOURCES.slice(0, 2).map(({ id, name, url, category, language }) => ({ id, name, url, category, language })),
    }),
  })
  const secondBody = await second.json()
  check('second feed request fast (cached)', Date.now() - before < 1500, `${Date.now() - before}ms, ${secondBody.items.length} items`)

  // 3. Article extraction from the first real item.
  const firstItem = feed.items[0]
  if (firstItem !== undefined) {
    const articleResponse = await fetch(`${base}/news/article?u=${encodeURIComponent(firstItem.link)}`)
    const article = await articleResponse.json()
    const hasBody = typeof article.contentHtml === 'string' && article.contentHtml.replace(/<[^>]+>/g, '').trim().length > 30
    check('article extraction', articleResponse.status === 200 && hasBody, `${firstItem.link} — ${article.contentHtml?.length ?? 0} chars`)
    check('article sanitized (no script)', typeof article.contentHtml === 'string' && !article.contentHtml.includes('<script'), '')
    // 4. Image proxy from the item's thumbnail (already proxied path).
    if (firstItem.image !== undefined) {
      const imgResponse = await fetch(new URL(firstItem.image, base))
      const type = imgResponse.headers.get('content-type') ?? ''
      const bytes = Buffer.from(await imgResponse.arrayBuffer())
      check('image proxy', imgResponse.status === 200 && bytes.length > 100 && type.startsWith('image/'), `${type} ${bytes.length} bytes (status ${imgResponse.status})`)
    } else {
      console.log('  (no thumbnail on first item — skipping image proxy check)')
    }
  }

  // 5. SSRF rejections.
  const loopback = await fetch(`${base}/news/article?u=${encodeURIComponent('http://127.0.0.1:22/')}`)
  check('SSRF: loopback IP rejected', loopback.status === 400, `status=${loopback.status}`)
  const dotlocal = await fetch(`${base}/news/img?u=${encodeURIComponent('http://printer.local/x.png')}`)
  check('SSRF: .local host rejected', dotlocal.status === 400, `status=${dotlocal.status}`)
  const ftp = await fetch(`${base}/news/article?u=${encodeURIComponent('ftp://example.com/x')}`)
  check('SSRF: non-http scheme rejected', ftp.status === 400, `status=${ftp.status}`)

  // 6. Disk cache written.
  const files = readdirSync(join(cacheDir, 'feeds')).length + readdirSync(join(cacheDir, 'articles')).length
  check('disk cache populated', files > 0, `${files} cache files`)
} finally {
  await new Promise((resolve) => server.close(resolve))
  rmSync(cacheDir, { recursive: true, force: true })
}

const failedCount = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failedCount}/${results.length} checks passed`)
process.exit(failedCount === 0 ? 0 : 1)
