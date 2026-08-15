/**
 * Client → Host API surface. All routes are same-origin (the web GUI and the
 * /news/* routes share the Host webserver), so plain relative fetch works.
 */
import type { ArticleResponse, FeedResponse, NewsSource } from '../shared/types.ts'

/** Fetch the aggregated feed (Host caches per source URL). */
export async function fetchFeed(
  sources: NewsSource[],
  options: { ttlMinutes?: number; imageProxy?: boolean } = {},
): Promise<FeedResponse> {
  const response = await fetch('/news/feed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sources: sources.map(({ id, name, url, category, language, favicon, builtin }) => ({
        id, name, url, category, language, favicon, builtin,
      })),
      ttlMinutes: options.ttlMinutes,
      imageProxy: options.imageProxy,
    }),
  })
  if (!response.ok) {
    throw new Error(`feed request failed: ${response.status}`)
  }
  return await response.json() as FeedResponse
}

/** Fetch an article body (sanitized HTML, images proxied). */
export async function fetchArticle(url: string): Promise<ArticleResponse> {
  const response = await fetch(`/news/article?u=${encodeURIComponent(url)}`)
  if (!response.ok) {
    throw new Error(`article request failed: ${response.status}`)
  }
  return await response.json() as ArticleResponse
}
