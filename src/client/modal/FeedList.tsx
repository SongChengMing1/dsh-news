/**
 * Feed list view: card stream with source badge, title, summary, relative
 * time and thumbnail; loading skeleton, empty state, full-failure state and
 * per-source degradation banners.
 */
import { createElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NewsItem } from '../../shared/types.ts'
import { NEWS_NS } from '../locales.ts'
import { filterByCategory, relativeTime, type FeedState } from '../feed-state.ts'
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
  onOpen: (item: NewsItem) => void
  onRetry: () => void
}

/** Localize a relative-time minute count. */
function timeLabel(t: TranslateNS<typeof NEWS_NS>, minutes: number | undefined): string {
  if (minutes === undefined) return ''
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: String(minutes) })
  if (minutes < 1440) return t('time.hoursAgo', { n: String(Math.floor(minutes / 60)) })
  return t('time.daysAgo', { n: String(Math.floor(minutes / 1440)) })
}

function Thumb(props: { item: NewsItem; t: TranslateNS<typeof NEWS_NS> }): ReturnType<typeof createElement> | null {
  const { item } = props
  if (item.image === undefined || item.image === '') return null
  return createElement('img', {
    src: item.image,
    alt: '',
    style: thumbStyle,
    loading: 'lazy',
  })
}

function Card(props: { item: NewsItem; t: TranslateNS<typeof NEWS_NS>; onOpen: () => void }): ReturnType<typeof createElement> {
  const { item, t, onOpen } = props
  const color = CATEGORY_COLORS[item.source.category] ?? '#6b7280'
  const time = timeLabel(t, relativeTime(item.pubDate))
  return createElement(
    'div',
    { style: cardStyle, onClick: onOpen, role: 'button', tabIndex: 0 },
    createElement(
      'div',
      { style: { flex: '1 1 auto', minWidth: 0 } },
      createElement(
        'div',
        { style: sourceBadgeStyle(color) },
        createElement('span', { style: { width: 6, height: 6, borderRadius: 3, background: color, display: 'inline-block' } }),
        createElement('span', null, item.source.name),
      ),
      createElement('h3', { style: titleStyle }, item.title),
      item.summary !== ''
        ? createElement('p', { style: summaryStyle }, item.summary)
        : null,
      time !== '' ? createElement('div', { style: timeStyle }, time) : null,
    ),
    createElement(Thumb, { item, t }),
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
  const { t, feed, category, onOpen, onRetry } = props

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

  const items = filterByCategory(feed, category)

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
    null,
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
    items.map((item) => createElement(Card, { key: item.link, item, t, onOpen: () => onOpen(item) })),
  )
}
