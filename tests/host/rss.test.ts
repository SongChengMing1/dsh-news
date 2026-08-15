import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NewsSource } from '../../src/shared/types'
import { fetchFeed, stripHtml } from '../../src/host/rss'
import { FetchError } from '../../src/host/fetcher'

vi.mock('../../src/host/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/fetcher')>()
  return {
    ...actual,
    fetchWithRetry: vi.fn(),
  }
})

import { fetchWithRetry } from '../../src/host/fetcher'

const source: NewsSource = {
  id: 'test-src',
  name: 'Test Source',
  url: 'https://feeds.example.com/rss.xml',
  category: 'world',
  language: 'en',
  builtin: true,
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Test Feed</title>
  <item>
    <title>First Article</title>
    <link>https://example.com/a1</link>
    <description><![CDATA[<p>Hello <b>world</b> <script>alert(1)</script>summary.</p>]]></description>
    <pubDate>Tue, 13 Aug 2025 10:00:00 GMT</pubDate>
    <media:content url="https://example.com/img1.jpg" medium="image"/>
  </item>
  <item>
    <title>Second Article</title>
    <link>https://example.com/a2</link>
    <description>No date item.</description>
    <enclosure url="https://example.com/img2.png" type="image/png"/>
  </item>
  <item>
    <title></title>
    <link>https://example.com/empty-title</link>
  </item>
  <item>
    <title>Duplicate</title>
    <link>https://example.com/a1</link>
  </item>
</channel>
</rss>`

describe('stripHtml', () => {
  it('removes tags, scripts and normalizes whitespace', () => {
    expect(stripHtml('<p>Hi <b>there</b></p>')).toBe('Hi there')
    expect(stripHtml('a<script>bad()</script>b')).toBe('a b')
    expect(stripHtml('a&nbsp;&amp;b')).toBe('a &b')
  })
})

describe('fetchFeed', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('parses and normalizes a feed', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: source.url,
      status: 200,
      headers: {},
      body: Buffer.from(SAMPLE_RSS, 'utf8'),
    })
    const items = await fetchFeed(source)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: 'First Article',
      link: 'https://example.com/a1',
      source: { id: 'test-src', name: 'Test Source', category: 'world' },
    })
    expect(items[0]?.summary).toContain('Hello world summary')
    expect(items[0]?.image).toBe('https://example.com/img1.jpg')
    expect(items[0]?.pubDate).toBeDefined()
    // Newest first: dated item before undated one.
    expect(items[0]?.title).toBe('First Article')
    expect(items[1]?.image).toBe('https://example.com/img2.png')
  })

  it('rejects script content in summaries', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: source.url,
      status: 200,
      headers: {},
      body: Buffer.from(SAMPLE_RSS, 'utf8'),
    })
    const items = await fetchFeed(source)
    expect(items[0]?.summary).not.toContain('<script>')
    expect(items[0]?.summary).not.toContain('<b>')
  })

  it('rewrites images through the proxy prefix when given', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: source.url,
      status: 200,
      headers: {},
      body: Buffer.from(SAMPLE_RSS, 'utf8'),
    })
    const items = await fetchFeed(source, '/news/img?u=')
    expect(items[0]?.image).toBe('/news/img?u=' + encodeURIComponent('https://example.com/img1.jpg'))
  })

  it('caps summaries to MAX_SUMMARY_LENGTH', async () => {
    const long = `<rss version="2.0"><channel><item><title>T</title><link>https://e.com/l</link><description>${'x'.repeat(500)}</description></item></channel></rss>`
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: source.url,
      status: 200,
      headers: {},
      body: Buffer.from(long, 'utf8'),
    })
    const items = await fetchFeed(source)
    expect(items[0]?.summary.length).toBeLessThanOrEqual(301)
    expect(items[0]?.summary.endsWith('…')).toBe(true)
  })

  it('propagates network failures', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new FetchError('TIMEOUT', 'timeout'))
    await expect(fetchFeed(source)).rejects.toThrow(FetchError)
  })
})
