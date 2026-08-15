import { describe, expect, it } from 'vitest'
import { applyFeedResponse, effectiveSources, filterByCategory, needsRefresh, relativeTime, type FeedState } from '../../src/client/feed-state'
import type { FeedResponse, NewsItem, NewsSource } from '../../src/shared/types'

const item = (id: string, category: NewsItem['source']['category'], pubDate?: string): NewsItem => ({
  title: id,
  summary: `${id} summary`,
  link: `https://example.com/${id}`,
  pubDate,
  source: { id: `src-${category}`, name: `Source ${category}`, category },
})

describe('filterByCategory', () => {
  const state: FeedState = {
    items: [item('a', 'world'), item('b', 'ai'), item('c', 'history')],
    failed: new Map(),
    lastLoadedAt: 0,
    loading: false,
    error: false,
  }

  it('returns everything for all/undefined', () => {
    expect(filterByCategory(state, undefined)).toHaveLength(3)
    expect(filterByCategory(state, 'all')).toHaveLength(3)
  })

  it('filters by category id', () => {
    expect(filterByCategory(state, 'ai').map((i) => i.title)).toEqual(['b'])
    expect(filterByCategory(state, 'science')).toHaveLength(0)
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2025-08-15T12:00:00Z')

  it('returns undefined for missing/invalid dates', () => {
    expect(relativeTime(undefined, now)).toBeUndefined()
    expect(relativeTime('garbage', now)).toBeUndefined()
  })

  it('computes minute deltas', () => {
    expect(relativeTime('2025-08-15T11:59:00Z', now)).toBe(1)
    expect(relativeTime('2025-08-15T10:00:00Z', now)).toBe(120)
    expect(relativeTime(now, now)).toBe(0)
    // Future dates clamp to 0.
    expect(relativeTime('2025-08-15T12:05:00Z', now)).toBe(0)
  })
})

describe('needsRefresh', () => {
  const base: FeedState = { items: [], failed: new Map(), lastLoadedAt: 0, loading: false, error: false }

  it('needs refresh when never loaded', () => {
    expect(needsRefresh(base, 15)).toBe(true)
  })

  it('does not need refresh within the TTL window', () => {
    const now = Date.now()
    expect(needsRefresh({ ...base, lastLoadedAt: now - 5 * 60 * 1000 }, 15, now)).toBe(false)
  })

  it('needs refresh after the TTL window', () => {
    const now = Date.now()
    expect(needsRefresh({ ...base, lastLoadedAt: now - 16 * 60 * 1000 }, 15, now)).toBe(true)
  })

  it('never refreshes while a request is in flight', () => {
    expect(needsRefresh({ ...base, loading: true, lastLoadedAt: 0 }, 15)).toBe(false)
  })
})

describe('applyFeedResponse', () => {
  const response: FeedResponse = {
    items: [item('a', 'world'), item('b', 'ai')],
    sources: [
      { sourceId: 'src-world', fetchedAt: '2025-08-15T12:00:00Z' },
      { sourceId: 'src-ai', fetchedAt: '2025-08-15T12:00:00Z', error: 'timeout' },
    ],
    fetchedAt: '2025-08-15T12:00:00Z',
    cached: false,
  }

  it('merges items and per-source failures with display names', () => {
    const names = new Map([['src-ai', 'AI Source']])
    const state = applyFeedResponse(response, names)
    expect(state.items).toHaveLength(2)
    expect(state.error).toBe(false)
    expect(state.loading).toBe(false)
    expect(state.failed.get('src-ai')).toEqual({ name: 'AI Source', error: 'timeout' })
    expect(state.failed.has('src-world')).toBe(false)
  })
})

describe('effectiveSources', () => {
  const builtins: readonly NewsSource[] = [
    { id: 'b1', name: 'B1', url: 'https://b1/rss', category: 'world', language: 'en', builtin: true },
    { id: 'b2', name: 'B2', url: 'https://b2/rss', category: 'ai', language: 'zh', builtin: true },
  ]
  const custom: NewsSource[] = [{ id: 'c1', name: 'C1', url: 'https://c1/rss', category: 'history', language: 'en', builtin: false }]

  it('excludes disabled built-ins and appends custom sources', () => {
    const sources = effectiveSources(builtins, custom, ['b1'])
    expect(sources.map((s) => s.id)).toEqual(['b2', 'c1'])
  })

  it('keeps everything when nothing is disabled', () => {
    expect(effectiveSources(builtins, custom, [])).toHaveLength(3)
  })
})
