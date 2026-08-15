/**
 * Feed list view: card stream with source badge, title, summary, relative
 * time and thumbnail; loading skeleton, empty state, full-failure state and
 * per-source degradation banners.
 *
 * Translation is a single master switch ("translate list"): when enabled,
 * cards are translated automatically as they scroll into view (an
 * IntersectionObserver watches the modal's scroll container; without IO the
 * rendered cards are translated in one pass). Each card translates once
 * (dedup by link); failures surface a per-card retry button.
 */
import { createElement, useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NewsItem } from '../../shared/types.ts'
import { NEWS_NS } from '../locales.ts'
import { filterByCategory, relativeTime, type FeedState } from '../feed-state.ts'
import { targetLanguageFor, translateCardTexts } from '../translate.ts'
import {
  cardStyle,
  CATEGORY_COLORS,
  ghostButtonStyle,
  sourceBadgeStyle,
  summaryStyle,
  TEXT_MUTED,
  thumbStyle,
  timeStyle,
  titleStyle,
} from './styles.ts'

interface FeedListProps {
  t: TranslateNS<typeof NEWS_NS>
  feed: FeedState
  category: string
  /** Read the active GUI locale id at call time (translation target). */
  getLocale: () => string
  /** Master switch: auto-translate cards as they scroll into view. */
  autoTranslate: boolean
  onToggleAutoTranslate: () => void
  onOpen: (item: NewsItem) => void
  onRetry: () => void
}

/** One card's translation outcome (keyed by item link in the parent). */
interface CardTranslation {
  title?: string
  summary?: string
}

/** Localize a relative-time minute count. */
function timeLabel(t: TranslateNS<typeof NEWS_NS>, minutes: number | undefined): string {
  if (minutes === undefined) return ''
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: String(minutes) })
  if (minutes < 1440) return t('time.hoursAgo', { n: String(Math.floor(minutes / 60)) })
  return t('time.daysAgo', { n: String(Math.floor(minutes / 1440)) })
}

function Thumb(props: { item: NewsItem }): ReturnType<typeof createElement> | null {
  const { item } = props
  const [broken, setBroken] = useState(false)
  if (item.image === undefined || item.image === '' || broken) return null
  return createElement('img', {
    src: item.image,
    alt: '',
    style: thumbStyle,
    loading: 'lazy',
    onError: () => setBroken(true),
  })
}

/** Small inline status/action affordance on each card. */
const cardStatusStyle = {
  border: 'none',
  background: 'transparent',
  color: '#2f6fed',
  fontSize: 11,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  flex: 'none',
} as const

const cardHintStyle = {
  fontSize: 11,
  color: TEXT_MUTED,
  flex: 'none',
} as const

function Card(props: {
  item: NewsItem
  t: TranslateNS<typeof NEWS_NS>
  translated: CardTranslation | undefined
  translating: boolean
  failed: boolean
  onRetry: () => void
  onOpen: () => void
}): ReturnType<typeof createElement> {
  const { item, t, translated, translating, failed, onRetry, onOpen } = props
  const color = CATEGORY_COLORS[item.source.category] ?? '#6b7280'
  const time = timeLabel(t, relativeTime(item.pubDate))

  const title = translated?.title ?? item.title
  const summary = translated?.summary ?? item.summary

  const status = translating
    ? createElement('span', { style: cardHintStyle }, t('list.translating'))
    : failed
      ? createElement('button', {
        style: cardStatusStyle,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          onRetry()
        },
        children: t('list.retry'),
      })
      : null

  return createElement(
    'div',
    {
      'data-news-link': item.link,
      style: cardStyle,
      onClick: onOpen,
      role: 'button',
      tabIndex: 0,
      onKeyDown: (event: { key: string; preventDefault: () => void }) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      },
    },
    createElement(
      'div',
      { style: { flex: '1 1 auto', minWidth: 0 } },
      createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        createElement(
          'div',
          { style: sourceBadgeStyle(color) },
          createElement('span', { style: { width: 6, height: 6, borderRadius: 3, background: color, display: 'inline-block' } }),
          createElement('span', null, item.source.name),
        ),
        createElement('div', { style: { flex: 1 } }),
        status,
      ),
      createElement('h3', { style: titleStyle }, title),
      summary !== ''
        ? createElement('p', { style: summaryStyle }, summary)
        : null,
      time !== '' ? createElement('div', { style: timeStyle }, time) : null,
    ),
    createElement(Thumb, { item }),
  )
}

/** Loading skeleton rows. */
function Skeleton(): ReturnType<typeof createElement> {
  const row = (width: string): ReturnType<typeof createElement> =>
    createElement('div', {
      style: {
        height: 12,
        borderRadius: 6,
        background: '#f3f4f6',
        width,
        marginBottom: 8,
      },
    })
  return createElement(
    'div',
    null,
    [0, 1, 2, 3, 4].map((i) =>
      createElement('div', { key: i, style: { padding: '10px 0', borderBottom: '1px solid #e5e7eb' } },
        row('30%'),
        row('90%'),
        row('70%'),
      ),
    ),
  )
}

export function FeedList(props: FeedListProps): ReturnType<typeof createElement> {
  const { t, feed, category, getLocale, autoTranslate, onToggleAutoTranslate, onOpen, onRetry } = props

  // Translation state, keyed by item link (survives category switches).
  const [translated, setTranslated] = useState<Map<string, CardTranslation>>(new Map())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement | null>(null)

  // Mirrors so the IntersectionObserver callback never reads stale state.
  const translatedRef = useRef(translated)
  translatedRef.current = translated
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  /** Translate one item unless already translated or in flight. */
  const ensureTranslated = (item: NewsItem): void => {
    if (!autoTranslate) return
    if (translatedRef.current.has(item.link) || pendingRef.current.has(item.link)) return
    setPending((prev) => {
      if (prev.has(item.link)) return prev
      const next = new Set(prev)
      next.add(item.link)
      return next
    })
    const to = targetLanguageFor(getLocale())
    void translateCardTexts(item.title, item.summary, to)
      .then((result) => {
        setTranslated((prev) => {
          if (prev.has(item.link)) return prev
          const next = new Map(prev)
          next.set(item.link, { title: result.title, summary: result.summary })
          return next
        })
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(item.link)
          return next
        })
        setFailed((prev) => {
          if (!prev.has(item.link)) return prev
          const next = new Set(prev)
          next.delete(item.link)
          return next
        })
      })
      .catch(() => {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(item.link)
          return next
        })
        setFailed((prev) => {
          if (prev.has(item.link)) return prev
          const next = new Set(prev)
          next.add(item.link)
          return next
        })
      })
  }

  const items = filterByCategory(feed, category)
  // Render cap: protects the DOM when many sources are enabled (the Host
  // already caps per-source items at 50).
  const RENDER_CAP = 300
  const rendered = items.slice(0, RENDER_CAP)

  // Auto-translate: watch the scroll container and translate cards as they
  // enter (rootMargin prefetches just-out-of-view cards). Without
  // IntersectionObserver (jsdom / old browsers) translate everything in one
  // pass.
  useEffect(() => {
    if (!autoTranslate) return
    const root = listRef.current?.parentElement ?? null
    if (root === null || typeof IntersectionObserver === 'undefined') {
      for (const item of rendered) ensureTranslated(item)
      return
    }
    const byLink = new Map(rendered.map((item) => [item.link, item]))
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const link = (entry.target as HTMLElement).dataset.newsLink
        const item = byLink.get(link ?? '')
        if (item !== undefined) ensureTranslated(item)
      }
    }, { root, rootMargin: '300px 0px' })
    for (const element of root.querySelectorAll<HTMLElement>('[data-news-link]')) {
      observer.observe(element)
    }
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, feed, category, getLocale])

  if (feed.loading && feed.items.length === 0) {
    return createElement('div', { style: { color: TEXT_MUTED, fontSize: 13 } },
      createElement(Skeleton, null),
    )
  }

  if (feed.error) {
    return createElement(
      'div',
      { style: { textAlign: 'center', padding: '48px 0', color: TEXT_MUTED, fontSize: 13 } },
      createElement('div', null, t('list.failed')),
      createElement('button', { style: { ...ghostButtonStyle, marginTop: 12 }, onClick: onRetry }, t('action.retry')),
    )
  }

  if (items.length === 0 && !feed.loading) {
    return createElement(
      'div',
      { style: { textAlign: 'center', padding: '48px 0', color: TEXT_MUTED, fontSize: 13 } },
      t('list.empty'),
    )
  }

  // Per-source degradation banners (only for categories currently shown).
  const failedEntries = [...feed.failed.entries()]
  const visibleFailed = category === 'all' || category === undefined
    ? failedEntries
    : failedEntries.filter(([id]) => items.some((item) => item.source.id === id))

  return createElement(
    'div',
    { ref: listRef },
    // Master translation switch row
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
      createElement(
        'button',
        {
          style: autoTranslate ? { ...ghostButtonStyle, color: '#2f6fed', border: '1px solid #2f6fed' } : ghostButtonStyle,
          onClick: onToggleAutoTranslate,
          children: autoTranslate ? t('list.autoTranslateOff') : t('list.autoTranslate'),
        },
      ),
      autoTranslate
        ? createElement('span', { style: { fontSize: 12, color: TEXT_MUTED } }, t('list.autoTranslateHint'))
        : null,
    ),
    visibleFailed.length > 0
      ? createElement(
        'div',
        { style: { marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
        visibleFailed.map(([id, detail]) =>
          createElement(
            'div',
            { key: id, style: { fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px' } },
            t('source.failed', { name: detail.name }),
          ),
        ),
      )
      : null,
    rendered.map((item) =>
      createElement(Card, {
        key: item.link,
        item,
        t,
        translated: autoTranslate ? translated.get(item.link) : undefined,
        translating: pending.has(item.link),
        failed: failed.has(item.link),
        onRetry: () => ensureTranslated(item),
        onOpen: () => onOpen(item),
      }),
    ),
  )
}
