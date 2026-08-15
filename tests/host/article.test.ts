/**
 * Article extraction tests: feed a real HTML document through the full
 * pipeline (jsdom + Readability + sanitize), mocking only the network layer.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { extractArticle } from '../../src/host/article'
import { FetchError } from '../../src/host/fetcher'

vi.mock('../../src/host/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/fetcher')>()
  return {
    ...actual,
    fetchWithRetry: vi.fn(),
  }
})

import { fetchWithRetry } from '../../src/host/fetcher'

const HTML = `<!DOCTYPE html>
<html><head><title>Real Article</title></head>
<body>
  <nav><a href="/home">Nav</a></nav>
  <article>
    <h1>Real Article</h1>
    <p>This is the first paragraph of a real article body with enough text to pass the Readability threshold. It talks about news and events and continues for a while with meaningful sentences.</p>
    <p><img src="https://cdn.example.com/photo.jpg" alt="photo">Second paragraph with more text that keeps going and going to build up a decent length of body copy for the extractor to work with reliably.</p>
    <script>alert('xss')</script>
    <p onclick="evil()">Third paragraph with an event handler attribute that must be removed by sanitization along with everything else unsafe.</p>
  </article>
  <footer>Footer content that is not part of the article.</footer>
</body></html>`

describe('extractArticle', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('extracts, sanitizes and proxies images', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://example.com/story',
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(HTML, 'utf8'),
    })
    const result = await extractArticle(new URL('https://example.com/story'), '/news/img?u=', 'https://example.com/story')
    expect(result.title).toBe('Real Article')
    expect(result.contentHtml).toContain('first paragraph')
    expect(result.contentHtml).toContain('/news/img?u=' + encodeURIComponent('https://cdn.example.com/photo.jpg'))
    expect(result.contentHtml).not.toContain('<script')
    expect(result.contentHtml).not.toContain('onclick')
    expect(result.contentHtml).not.toContain('evil()')
    expect(result.link).toBe('https://example.com/story')
  })

  it('throws EMPTY when readability finds no body', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://example.com/short',
      status: 200,
      headers: {},
      body: Buffer.from('<html><head><title>X</title></head><body><p>hi</p></body></html>', 'utf8'),
    })
    await expect(extractArticle(new URL('https://example.com/short'), undefined, 'https://example.com/short'))
      .rejects.toThrow(/no article body/)
  })

  it('propagates network errors', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new FetchError('TIMEOUT', 'timeout'))
    await expect(extractArticle(new URL('https://example.com/down'), undefined, 'https://example.com/down'))
      .rejects.toThrow(FetchError)
  })
})
