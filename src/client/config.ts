/**
 * Client-side configuration, persisted in localStorage under
 * `dsh.news.config.v1` (see 总体方案 §8). The Host stays stateless — the
 * source list and options ride along with each feed request.
 */
import type { NewsSource } from '../shared/types.ts'
import { DEFAULT_DISABLED_SOURCE_IDS } from '../shared/sources.ts'

/** localStorage key. */
export const CONFIG_KEY = 'dsh.news.config.v1'

/** All settings the user can change. */
export interface NewsConfig {
  /** User-added sources. */
  customSources: NewsSource[]
  /** Built-in source ids the user disabled. */
  disabledSources: string[]
  /** Optional self-hosted RSSHub instance. */
  rsshubInstance?: string
  /** Proxy images through the Host (default true). */
  imageProxy?: boolean
  /** Feed TTL in minutes (default 15). */
  ttlMinutes?: number
  /** Summary-only mode (default false). */
  summaryOnly?: boolean
  /** Auto-translate list cards as they scroll into view (default false). */
  autoTranslateList?: boolean
}

export const DEFAULT_CONFIG: NewsConfig = {
  customSources: [],
  disabledSources: [...DEFAULT_DISABLED_SOURCE_IDS],
  imageProxy: true,
  ttlMinutes: 15,
  summaryOnly: false,
  autoTranslateList: false,
}

/** Deep-merge the stored config over the defaults (unknown keys dropped). */
export function normalizeConfig(raw: unknown): NewsConfig {
  const base: NewsConfig = {
    customSources: [],
    disabledSources: [...DEFAULT_DISABLED_SOURCE_IDS],
    imageProxy: true,
    ttlMinutes: 15,
    summaryOnly: false,
    autoTranslateList: false,
  }
  if (raw === null || typeof raw !== 'object') return base
  const value = raw as Record<string, unknown>
  if (Array.isArray(value.customSources)) {
    base.customSources = value.customSources.filter(isSourceShape)
  }
  if (Array.isArray(value.disabledSources)) {
    base.disabledSources = value.disabledSources.filter((id): id is string => typeof id === 'string')
  }
  if (typeof value.rsshubInstance === 'string' && value.rsshubInstance !== '') {
    base.rsshubInstance = value.rsshubInstance
  }
  if (typeof value.imageProxy === 'boolean') base.imageProxy = value.imageProxy
  if (typeof value.ttlMinutes === 'number' && value.ttlMinutes >= 1 && value.ttlMinutes <= 1440) {
    base.ttlMinutes = value.ttlMinutes
  }
  if (typeof value.summaryOnly === 'boolean') base.summaryOnly = value.summaryOnly
  if (typeof value.autoTranslateList === 'boolean') base.autoTranslateList = value.autoTranslateList
  return base
}

/** Loose shape guard for custom sources from storage. */
function isSourceShape(value: unknown): value is NewsSource {
  if (value === null || typeof value !== 'object') return false
  const source = value as Record<string, unknown>
  return (
    typeof source.id === 'string' &&
    typeof source.name === 'string' &&
    typeof source.url === 'string' &&
    typeof source.category === 'string' &&
    typeof source.language === 'string'
  )
}

/** Read the persisted config (defaults when absent or corrupt). */
export function loadConfig(): NewsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw === null) return { ...DEFAULT_CONFIG }
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** Persist a config (best effort). */
export function saveConfig(config: NewsConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    // storage full / private mode — degrade silently
  }
}
