/**
 * Article body extraction: fetch the page, extract the readable content with
 * Readability (jsdom), sanitize it to a safe whitelist, and rewrite image
 * URLs through the image proxy.
 */
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import sanitizeHtml from 'sanitize-html'
import { fetchWithRetry, globalLimiter, FetchError } from './fetcher.ts'

/** Max article page size (some sites are heavy). */
const MAX_ARTICLE_BYTES = 10 * 1024 * 1024

/** Allowed tags after sanitization. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'figure', 'figcaption',
  'img', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'table',
  'thead', 'tbody', 'tr', 'th', 'td',
] as const

/** Result of an extraction. */
export interface ExtractedArticle {
  title: string
  /** Sanitized body HTML with images proxied. */
  contentHtml: string
  /** Canonical link (final URL after redirects). */
  link: string
}

/**
 * Extract the readable article from a page URL.
 * @param url - validated article URL.
 * @param imageProxyPrefix - prefix to rewrite `<img src>` through (e.g.
 * `/news/img?u=`); images stay untouched when undefined.
 * @param referer - original page URL used as Referer for the fetch.
 * @throws FetchError on network failures; returns undefined-ish extraction
 * via {@link extractionFailed} semantics when Readability finds nothing.
 */
export async function extractArticle(
  url: URL,
  imageProxyPrefix: string | undefined,
  referer: string,
): Promise<ExtractedArticle> {
  const fetched = await globalLimiter.run(() => fetchWithRetry(url, {
    maxBytes: MAX_ARTICLE_BYTES,
    referer,
  }))

  // Some pages declare non-UTF-8 encodings; jsdom honors the meta charset
  // when given a Buffer. Pass the raw bytes to let jsdom detect encoding.
  const dom = new JSDOM(fetched.body, {
    url: fetched.url,
    contentType: typeof fetched.headers['content-type'] === 'string'
      ? fetched.headers['content-type']
      : 'text/html; charset=utf-8',
  })

  const doc = dom.window.document
  const reader = new Readability(doc, { charThreshold: 120 })
  const article = reader.parse()
  if (article === null || (article.textContent ?? '').trim().length < 80) {
    throw new FetchError('EMPTY', 'readability found no article body')
  }

  let contentHtml = article.content ?? ''

  // Sanitize first (absolute http(s) srcs survive; everything unsafe goes),
  // then rewrite surviving image srcs through the proxy prefix.
  const safe = sanitizeHtml(contentHtml, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      img: ['src', 'alt', 'width', 'height'],
      a: ['href'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      img: (_tagName, attribs) => {
        const src = attribs.src ?? ''
        if (!src.startsWith('http://') && !src.startsWith('https://')) {
          return { tagName: 'img', attribs: { ...attribs, src: '' } }
        }
        return { tagName: 'img', attribs }
      },
      a: (_tagName, attribs) => {
        const href = attribs.href ?? ''
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          return { tagName: 'a', attribs: { ...attribs, href: '' } }
        }
        return { tagName: 'a', attribs }
      },
    },
  })

  if (imageProxyPrefix !== undefined) {
    contentHtml = rewriteImages(safe, imageProxyPrefix)
  } else {
    contentHtml = safe
  }

  const title = article.title !== undefined && article.title !== null && article.title.trim() !== ''
    ? article.title
    : new URL(fetched.url).hostname
  return { title, contentHtml, link: fetched.url }
}

/** Rewrite absolute http(s) image srcs through the image proxy prefix. */
function rewriteImages(html: string, prefix: string): string {
  return html.replace(/(<img[^>]*\ssrc=")(https?:\/\/[^"]+)(")/gi, (_match, before: string, src: string, after: string) => {
    return `${before}${prefix}${encodeURIComponent(src)}${after}`
  })
}
