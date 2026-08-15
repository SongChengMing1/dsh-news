/**
 * Reading view: fetches the sanitized article body from the Host
 * (/news/article) and renders it inline. Images are already proxied by the
 * Host; if a proxied image fails to load, the client falls back to the
 * original URL (decoded from the proxy path). On extraction failure the view
 * degrades to the summary + original link.
 */
import { createElement, useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NewsItem } from '../../shared/types.ts'
import { fetchArticle, translateArticle } from '../api.ts'
import { NEWS_NS, type NewsKey } from '../locales.ts'
import { targetLanguageFor } from '../translate.ts'
import { BORDER, ghostButtonStyle, TEXT, TEXT_MUTED } from './styles.ts'

interface ReadingViewProps {
  t: TranslateNS<typeof NEWS_NS>
  item: NewsItem
  summaryOnly: boolean
  /** Translate automatically once the body loads (list master switch on). */
  autoTranslate: boolean
  /** Read the active GUI locale id ("zh" | "en") at call time. */
  getLocale: () => string
  onBack: () => void
}

interface ArticleState {
  status: 'loading' | 'ok' | 'failed'
  title: string
  html: string
}

interface TranslationState {
  status: 'idle' | 'translating' | 'ok' | 'failed'
  text?: string
  /** Translated title (best-effort; falls back to the original). */
  title?: string
}

/** Decode the original URL out of a proxied /news/img?u= path. */
export function decodeProxiedImage(src: string): string | undefined {
  const marker = '/news/img?u='
  const index = src.indexOf(marker)
  if (index === -1) return undefined
  try {
    return decodeURIComponent(src.slice(index + marker.length))
  } catch {
    return undefined
  }
}

/**
 * Extract plain text from sanitized article HTML for translation: block
 * elements become blank-line paragraph breaks, <br> becomes a single
 * newline, remaining tags are stripped, and the common HTML entities are
 * decoded. Paragraph structure is preserved so the Host can chunk and
 * rejoin it cleanly.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|td|th|figcaption|section|article)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Stylesheet injected once per reading mount (scoped to the article body). */
const ARTICLE_CSS = `
.dsh-news-article img { max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; }
.dsh-news-article figure { margin: 12px 0; }
.dsh-news-article figcaption { font-size: 12px; color: ${TEXT_MUTED}; text-align: center; margin-top: 4px; }
.dsh-news-article pre { background: #f6f8fa; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 13px; }
.dsh-news-article code { background: #f6f8fa; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
.dsh-news-article blockquote { border-left: 3px solid #d1d5db; margin: 12px 0; padding-left: 14px; color: ${TEXT_MUTED}; }
.dsh-news-article a { color: #2f6fed; }
.dsh-news-article h1, .dsh-news-article h2, .dsh-news-article h3 { line-height: 1.4; margin: 18px 0 8px; }
.dsh-news-article table { border-collapse: collapse; width: 100%; margin: 12px 0; }
.dsh-news-article th, .dsh-news-article td { border: 1px solid #e5e7eb; padding: 6px 10px; font-size: 13px; }
`

/**
 * Mount a delegated image-fallback listener on the article container:
 * proxied images that fail swap to their original URL once (a data attribute
 * prevents an infinite retry loop).
 */
function attachImageFallback(container: HTMLElement | null): (() => void) | undefined {
  if (container === null) return undefined
  const onError = (event: Event): void => {
    const target = event.target as HTMLImageElement | null
    if (target === null || target.tagName !== 'IMG') return
    if (target.dataset.fallbackApplied === 'true') return
    const original = decodeProxiedImage(target.src)
    if (original === undefined) return
    target.dataset.fallbackApplied = 'true'
    target.src = original
  }
  container.addEventListener('error', onError, true)
  return () => container.removeEventListener('error', onError, true)
}

export function ReadingView(props: ReadingViewProps): ReturnType<typeof createElement> {
  const { t, item, summaryOnly, autoTranslate, getLocale, onBack } = props
  const [state, setState] = useState<ArticleState>({ status: 'loading', title: item.title, html: '' })
  const [translation, setTranslation] = useState<TranslationState>({ status: 'idle' })
  const [showingTranslation, setShowingTranslation] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', title: item.title, html: '' })
    setTranslation({ status: 'idle' })
    setShowingTranslation(false)
    if (summaryOnly) {
      setState({ status: 'failed', title: item.title, html: '' })
      return
    }
    void fetchArticle(item.link)
      .then((article) => {
        if (cancelled) return
        setState({ status: 'ok', title: article.title || item.title, html: article.contentHtml })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'failed', title: item.title, html: '' })
      })
    return () => { cancelled = true }
  }, [item, summaryOnly])

  useEffect(() => attachImageFallback(containerRef.current), [state.status])

  // Auto-translate when the list master switch is on: fire as soon as the
  // article body loads, without a manual click. Idempotent — the status
  // guard skips once translating/ok/failed, and failures stay manual.
  useEffect(() => {
    if (!autoTranslate) return
    if (state.status !== 'ok' || state.html === '') return
    if (translation.status !== 'idle') return
    onToggleTranslate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, state.status, translation.status])

  // Inject the scoped article stylesheet while this view is mounted.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = ARTICLE_CSS
    style.dataset.dshNewsArticleCss = ''
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  /** Toggle translation: first click translates, later clicks flip views. */
  const onToggleTranslate = (): void => {
    if (translation.status === 'translating') return
    if (translation.status === 'ok' && translation.text !== undefined) {
      setShowingTranslation((visible) => !visible)
      return
    }
    if (state.status !== 'ok' || state.html === '') return
    setTranslation({ status: 'translating' })
    const to = targetLanguageFor(getLocale())
    // Title + body in parallel; the body is required, the title is
    // best-effort (falls back to the original when its request fails).
    const titleJob = translateArticle(state.title, to).then((result) => result.text)
    const bodyJob = translateArticle(htmlToText(state.html), to).then((result) => result.text)
    void Promise.allSettled([titleJob, bodyJob]).then(([titleResult, bodyResult]) => {
      if (bodyResult.status !== 'fulfilled') {
        setTranslation({ status: 'failed' })
        return
      }
      setTranslation({
        status: 'ok',
        text: bodyResult.value,
        title: titleResult.status === 'fulfilled' ? titleResult.value : undefined,
      })
      setShowingTranslation(true)
    })
  }

  const translateLabel =
    translation.status === 'translating'
      ? t('reading.translating')
      : translation.status === 'ok' && showingTranslation
        ? t('reading.showOriginal')
        : t('reading.translate')

  const openOriginal = createElement(
    'a',
    {
      href: item.link,
      target: '_blank',
      rel: 'noopener noreferrer',
      style: {
        display: 'inline-block',
        ...ghostButtonStyle,
        textDecoration: 'none',
        marginTop: 16,
      },
    },
    t('reading.openOriginal'),
  )

  return createElement(
    'div',
    null,
    // Back row (translate toggle rides along once the body is loaded)
    createElement(
      'div',
      { style: { marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 } },
      createElement('button', { style: ghostButtonStyle, onClick: onBack, children: `‹ ${t('reading.back')}` }),
      createElement('div', { style: { flex: 1 } }),
      state.status === 'ok'
        ? createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          translation.status === 'failed'
            ? createElement('span', { style: { fontSize: 12, color: '#b45309' } }, t('reading.translateFailed'))
            : null,
          createElement(
            'button',
            {
              style: ghostButtonStyle,
              onClick: onToggleTranslate,
              disabled: translation.status === 'translating',
              title: t('reading.translate'),
            },
            translateLabel,
          ),
        )
        : null,
    ),
    // Title (translated once the translation view is active)
    createElement('h2', {
      style: { fontSize: 20, fontWeight: 700, lineHeight: 1.4, margin: '4px 0 12px', color: TEXT },
    }, showingTranslation && translation.status === 'ok' ? (translation.title ?? state.title) : state.title),
    // Source line
    createElement('div', { style: { fontSize: 12, color: TEXT_MUTED, marginBottom: 14 } }, item.source.name),

    state.status === 'loading'
      ? createElement('div', { style: { color: TEXT_MUTED, fontSize: 13, padding: '24px 0' } }, t('reading.loading'))
      : state.status === 'failed'
        ? createElement(
          'div',
          { style: { color: TEXT_MUTED, fontSize: 13 } },
          summaryOnly
            ? createElement('p', null, t('reading.summaryOnly'))
            : createElement('p', null, t('reading.failed')),
          item.summary !== '' ? createElement('p', { style: { margin: '12px 0', lineHeight: 1.7, color: TEXT } }, item.summary) : null,
          openOriginal,
        )
        : showingTranslation && translation.text !== undefined
          ? createElement(
            'div',
            {
              className: 'dsh-news-article',
              style: {
                fontSize: 15,
                lineHeight: 1.8,
                color: TEXT,
                overflowWrap: 'break-word',
              },
            },
            translation.text
              .split(/\n+/)
              .map((line) => line.trim())
              .filter((line) => line !== '')
              .map((line, index) => createElement('p', { key: index }, line)),
            createElement('div', { style: { borderTop: `1px solid ${BORDER}`, marginTop: 20, paddingTop: 14 } }, openOriginal),
          )
          : createElement(
            'div',
            {
              ref: containerRef,
              className: 'dsh-news-article',
              style: {
                fontSize: 15,
                lineHeight: 1.8,
                color: TEXT,
                overflowWrap: 'break-word',
              },
            },
            createElement('div', {
              // The Host sanitizes to a safe whitelist before serving.
              dangerouslySetInnerHTML: { __html: state.html },
            }),
            createElement('div', { style: { borderTop: `1px solid ${BORDER}`, marginTop: 20, paddingTop: 14 } }, openOriginal),
          ),
  )
}
