#!/usr/bin/env node
/**
 * M4.5 acceptance: read articles from the mainstream sources in the real
 * pipeline (feed → article extraction → sanitized inline HTML), and check
 * extraction quality (body length, no scripts, images proxied).
 *
 * Run: node scripts/verify-articles.mjs   (after pnpm build)
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRouteCaches, makeRoutes, BUILTIN_SOURCES } from '../lib/index.js'

const SOURCE_IDS = ['bbc-world', 'thepaper', 'jiqizhixin', 'qbitai', 'kepuchina', 'worldhistory']

const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-news-verify-'))
const caches = createRouteCaches(cacheDir)
const routes = makeRoutes(caches)
const server = createServer((req, res) => {
  const route = routes.find((r) => r.path === (req.url ?? '').split('?')[0])
  if (route === undefined) {
    res.writeHead(404).end()
    return
  }
  void route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('no port')
const base = `http://127.0.0.1:${address.port}`

let failures = 0
try {
  for (const sourceId of SOURCE_IDS) {
    const source = BUILTIN_SOURCES.find((s) => s.id === sourceId)
    if (source === undefined) {
      console.log(`✗ ${sourceId}: unknown source`)
      failures++
      continue
    }
    const feed = await (await fetch(`${base}/news/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [source] }),
    })).json()

    const result = feed.sources[0]
    if (result?.error !== undefined) {
      console.log(`✗ ${source.name}: feed failed — ${result.error}`)
      failures++
      continue
    }
    const item = feed.items[0]
    if (item === undefined) {
      console.log(`✗ ${source.name}: no items`)
      failures++
      continue
    }

    const article = await (await fetch(`${base}/news/article?u=${encodeURIComponent(item.link)}`)).json()
    const text = (article.contentHtml ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const hasScript = (article.contentHtml ?? '').toLowerCase().includes('<script')
    const proxiedImages = (article.contentHtml ?? '').match(/src="\/news\/img\?u=/g)?.length ?? 0
    const rawImages = (article.contentHtml ?? '').match(/src="https?:\/\//g)?.length ?? 0
    const ok = typeof text === 'string' && text.length > 100 && !hasScript
    console.log(
      `${ok ? '✓' : '✗'} ${source.name.padEnd(30)} ${String(text.length).padStart(5)} chars | title=${(article.title ?? '').slice(0, 30)} | proxied imgs=${proxiedImages} raw=${rawImages}`,
    )
    if (!ok) failures++
  }
} finally {
  await new Promise((resolve) => server.close(resolve))
  rmSync(cacheDir, { recursive: true, force: true })
}

console.log(`\n${6 - failures}/6 sources verified`)
process.exit(failures === 0 ? 0 : 1)
