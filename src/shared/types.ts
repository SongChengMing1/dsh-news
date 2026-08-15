/**
 * Shared types and constants for dsh-news (used by both the Host half and
 * the browser Client half).
 *
 * Category ids are the stable wire vocabulary: the Host aggregates feeds by
 * category id, and the Client renders tabs/colors from the same ids.
 */

/** The four built-in news categories. */
export type NewsCategory = 'world' | 'science' | 'history' | 'ai'

/** Display metadata for one category (labels live in the Client locales). */
export interface NewsCategoryMeta {
  /** Stable id used on the wire and in configs. */
  id: NewsCategory
  /** Short css-friendly color accent for badges/tabs. */
  color: string
}

/** The built-in categories, in display order. */
export const NEWS_CATEGORIES: readonly NewsCategoryMeta[] = [
  { id: 'world', color: '#2f6fed' },
  { id: 'ai', color: '#7c3aed' },
  { id: 'science', color: '#0d9488' },
  { id: 'history', color: '#b45309' },
] as const

/** Is an unknown string a valid category id? */
export function isNewsCategory(value: unknown): value is NewsCategory {
  return typeof value === 'string' && NEWS_CATEGORIES.some((c) => c.id === value)
}

/** One content source (built-in or user custom). */
export interface NewsSource {
  /** Stable id: built-in sources use their feed URL; custom sources too. */
  id: string
  /** Display name, e.g. "BBC World". */
  name: string
  /** RSS/Atom feed URL. */
  url: string
  /** Category the feed's items are aggregated under. */
  category: NewsCategory
  /** Two-letter language code of the feed content. */
  language: string
  /** Optional favicon URL (proxied through /news/img when enabled). */
  favicon?: string
  /** True for the built-in source list; false for user custom sources. */
  builtin?: boolean
}

/** One normalized article item returned by the Host feed route. */
export interface NewsItem {
  title: string
  /** Plain-text summary (a few sentences). */
  summary: string
  /** Canonical article URL. */
  link: string
  /** ISO timestamp of publication, when the feed provides one. */
  pubDate?: string
  /** Optional thumbnail image URL. */
  image?: string
  /** The source this item came from (denormalized for display). */
  source: {
    id: string
    name: string
    category: NewsCategory
    favicon?: string
  }
}

/** One source's fetch outcome inside a feed response (failure degradation). */
export interface FeedSourceResult {
  sourceId: string
  /** ISO timestamp when this source's items were fetched. */
  fetchedAt: string
  /** Present when the source failed; the Client renders it inline. */
  error?: string
}

/** The `/news/feed` route response. */
export interface FeedResponse {
  /** Fetched items, newest first, all requested sources merged. */
  items: NewsItem[]
  /** Per-source outcomes (success or degradation error). */
  sources: FeedSourceResult[]
  /** ISO timestamp of this response's generation. */
  fetchedAt: string
  /** True when served from cache. */
  cached: boolean
}

/** The `/news/article` route response. */
export interface ArticleResponse {
  /** Canonical article URL. */
  url: string
  /** Article title (from the page or the feed-provided title). */
  title: string
  /** Sanitized article body HTML (safe to render inline). */
  contentHtml: string
  /** Plain-text excerpt fallback, used when extraction failed. */
  summary?: string
  /** Original article URL (same as `url`; kept for the Client's link button). */
  link: string
  /** True when served from cache. */
  cached: boolean
}

/** The `/news/img` route response shape (binary; metadata via headers). */
export interface ImgResponseMeta {
  /** Content-type of the proxied image. */
  contentType: string
  /** True when served from cache. */
  cached: boolean
}
