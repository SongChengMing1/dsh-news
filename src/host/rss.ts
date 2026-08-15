/**
 * RSS/Atom feed fetching and normalization.
 *
 * Fetches go through the SSRF-guarded fetcher (validated, pinned, retried
 * once). Parsing uses rss-parser; every item is normalized into the shared
 * `NewsItem` model and cleaned (plain-text summaries, dedupe, size caps).
 */
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import type { NewsItem, NewsSource } from '../shared/types.ts'
import { FetchError, fetchWithRetry, globalLimiter } from './fetcher.ts'

/** Raw parsed item (pre-normalization), either from rss-parser or the fallback. */
interface RawItem {
  title?: string
  link?: string
  guid?: string
  pubDate?: string
  isoDate?: string
  contentSnippet?: string
  content?: string
  summary?: string
  enclosure?: { url?: string }
  mediaContent?: MediaEntry | MediaEntry[]
  mediaThumbnail?: MediaEntry
}

/** Media namespace entry: attribute-carrying elements parse as { $: {...} }. */
interface MediaEntry {
  url?: string
  $?: { url?: string }
}

/** Read the url off a media entry in either parse shape. */
function mediaUrl(entry: MediaEntry | undefined): string | undefined {
  if (entry === undefined) return undefined
  if (typeof entry.url === 'string' && entry.url !== '') return entry.url
  const raw = entry.$?.url
  if (typeof raw === 'string' && raw !== '') return raw
  return undefined
}

/** Max items kept per source (guards against pathological feeds). */
const MAX_ITEMS_PER_SOURCE = 50
/** Max summary length (characters). */
const MAX_SUMMARY_LENGTH = 300

const parser = new Parser<Record<string, unknown>, RawItem>({
  timeout: 12000,
  maxRedirects: 0, // redirects are handled by the validated fetcher
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
})

/** Strip HTML tags and entities from a string. */
export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract the first image URL from raw item fields. */
function itemImage(item: RawItem): string | undefined {
  const enclosure = item.enclosure?.url
  if (typeof enclosure === 'string' && enclosure !== '') return enclosure
  const media = item.mediaContent
  if (Array.isArray(media)) {
    for (const entry of media) {
      const url = mediaUrl(entry)
      if (url !== undefined) return url
    }
  } else {
    const url = mediaUrl(media)
    if (url !== undefined) return url
  }
  return mediaUrl(item.mediaThumbnail)
}

/**
 * Fallback parser for feeds rss-parser rejects (malformed XML, bare `&`,
 * RSS 0.9x variants): walk `<item>` elements with cheerio and map the
 * conventional child fields.
 */
function parseWithCheerio(xml: string): RawItem[] {
  const $ = cheerio.load(xml, { xml: { xmlMode: true } })
  const items: RawItem[] = []
  $('item, entry').each((_index, element) => {
    const node = $(element)
    const text = (selector: string): string | undefined => {
      const value = node.find(selector).first().text().trim()
      return value === '' ? undefined : value
    }
    const attr = (selector: string, name: string): string | undefined => {
      const value = node.find(selector).first().attr(name)
      return value !== undefined && value !== '' ? value : undefined
    }
    const item: RawItem = {
      title: text('title'),
      link: attr('link', 'href') ?? text('link') ?? text('guid'),
      guid: text('guid'),
      pubDate: text('pubDate') ?? text('published'),
      content: text('description') ?? text('content'),
      enclosure: attr('enclosure', 'url') !== undefined
        ? { url: attr('enclosure', 'url') }
        : undefined,
      mediaContent: attr('media\\:content', 'url') !== undefined
        ? { url: attr('media\\:content', 'url') }
        : undefined,
      mediaThumbnail: attr('media\\:thumbnail', 'url') !== undefined
        ? { url: attr('media\\:thumbnail', 'url') }
        : undefined,
    }
    items.push(item)
  })
  return items
}

/**
 * Parse feed XML into raw items: rss-parser first, then the lenient cheerio
 * fallback. Throws only when both fail.
 */
async function parseFeedXml(xml: string): Promise<RawItem[]> {
  try {
    const parsed = await parser.parseString(xml)
    const items = parsed.items ?? []
    if (items.length > 0) return items
  } catch {
    // fall through to the lenient parser
  }
  return parseWithCheerio(xml)
}

/**
 * Fetch and parse one feed, normalized into NewsItems.
 * @param source - the source definition.
 * @param imageProxyPrefix - optional prefix to rewrite image URLs through
 * (e.g. `/news/img?u=`); images stay untouched when undefined.
 * @returns the normalized items (newest first, capped).
 * @throws on network/parse failures (caller reports per-source degradation).
 */
export async function fetchFeed(
  source: NewsSource,
  imageProxyPrefix?: string,
): Promise<NewsItem[]> {
  const fetched = await globalLimiter.run(() => fetchWithRetry(new URL(source.url), {
    maxBytes: 2 * 1024 * 1024,
  }))

  const text = fetched.body.toString('utf8')
  // Anti-bot / captive pages return HTML instead of a feed — fail loudly so
  // the per-source degradation path reports the real cause.
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<rss') && !trimmed.startsWith('<feed') && !trimmed.startsWith('<RDF')) {
    throw new FetchError('NOT_FEED', `response is not a feed (${fetched.headers['content-type'] ?? 'unknown content-type'})`)
  }
  const rawItems = await parseFeedXml(text)
  if (rawItems.length === 0) {
    throw new FetchError('EMPTY', 'feed contains no items')
  }

  const items: NewsItem[] = []
  const seen = new Set<string>()
  for (const raw of rawItems) {
    const title = (raw.title ?? '').trim()
    const link = (raw.link ?? raw.guid ?? '').trim()
    if (title === '' || link === '') continue
    if (seen.has(link)) continue
    seen.add(link)

    // Summary: strip tags AND script/style bodies from the raw content HTML,
    // falling back to the parser's text snippet when no HTML is present.
    let summary = stripHtml(raw.content ?? raw.summary ?? '')
    if (summary === '') {
      summary = (raw.contentSnippet ?? '').trim()
    }
    if (summary.length > MAX_SUMMARY_LENGTH) {
      summary = `${summary.slice(0, MAX_SUMMARY_LENGTH)}…`
    }

    const pubDate = raw.isoDate ?? raw.pubDate
    let image = itemImage(raw)
    if (image !== undefined && imageProxyPrefix !== undefined) {
      image = `${imageProxyPrefix}${encodeURIComponent(image)}`
    }

    items.push({
      title,
      summary,
      link,
      pubDate,
      image,
      source: {
        id: source.id,
        name: source.name,
        category: source.category,
        favicon: source.favicon,
      },
    })
  }

  // Newest first.
  items.sort((a, b) => {
    const ta = a.pubDate === undefined ? 0 : Date.parse(a.pubDate)
    const tb = b.pubDate === undefined ? 0 : Date.parse(b.pubDate)
    return tb - ta
  })
  return items.slice(0, MAX_ITEMS_PER_SOURCE)
}
