/**
 * Feed state management and time formatting helpers (framework-free so they
 * are unit-testable without a DOM).
 */
import type { FeedResponse, NewsItem, NewsSource } from '../shared/types.ts'

/** One feed load outcome: items + per-source degradation info. */
export interface FeedState {
  items: NewsItem[]
  /** Sources that failed: sourceId → display name + error message. */
  failed: Map<string, { name: string; error: string }>
  /** Last successful load time (ms epoch); 0 = never. */
  lastLoadedAt: number
  /** True while a request is in flight. */
  loading: boolean
  /** True when the last request failed entirely. */
  error: boolean
}

export const EMPTY_FEED: FeedState = {
  items: [],
  failed: new Map(),
  lastLoadedAt: 0,
  loading: false,
  error: false,
}

/** Filter a loaded feed by category id (undefined = all). */
export function filterByCategory(state: FeedState, category: string | undefined): NewsItem[] {
  if (category === undefined || category === 'all') return state.items
  return state.items.filter((item) => item.source.category === category)
}

/**
 * Merge a FeedResponse into a FeedState (replaces items, keeps load timing).
 * @param names - sourceId → display name, used for degradation banners.
 */
export function applyFeedResponse(response: FeedResponse, names: Map<string, string> = new Map(), now = Date.now()): FeedState {
  const failed = new Map<string, { name: string; error: string }>()
  for (const result of response.sources) {
    if (result.error !== undefined && result.error !== '') {
      failed.set(result.sourceId, { name: names.get(result.sourceId) ?? result.sourceId, error: result.error })
    }
  }
  return {
    items: response.items,
    failed,
    lastLoadedAt: now,
    loading: false,
    error: false,
  }
}

/** Relative time label in minutes/hours/days (caller localizes). */
export function relativeTime(isoOrMs: string | number | undefined, now = Date.now()): number | undefined {
  if (isoOrMs === undefined) return undefined
  const time = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs)
  if (Number.isNaN(time)) return undefined
  const delta = Math.max(0, now - time)
  return Math.floor(delta / 60000)
}

/**
 * Should the feed be refreshed on modal open? True when never loaded, still
 * loading, or the last load is older than the TTL.
 */
export function needsRefresh(state: FeedState, ttlMinutes: number, now = Date.now()): boolean {
  if (state.loading) return false
  if (state.lastLoadedAt === 0) return true
  return now - state.lastLoadedAt > ttlMinutes * 60 * 1000
}

/** Build the effective source list: enabled built-ins + custom sources. */
export function effectiveSources(
  builtins: readonly NewsSource[],
  custom: NewsSource[],
  disabled: string[],
): NewsSource[] {
  const disabledSet = new Set(disabled)
  const enabledBuiltins = builtins.filter((s) => !disabledSet.has(s.id))
  return [...enabledBuiltins, ...custom]
}
