import { describe, expect, it, beforeEach } from 'vitest'
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig, CONFIG_KEY } from '../../src/client/config'

/** Minimal localStorage stand-in (jsdom-free node env). */
function installLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

describe('normalizeConfig', () => {
  it('returns defaults for null / garbage', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig('nope')).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig(42)).toEqual(DEFAULT_CONFIG)
  })

  it('drops malformed custom sources and disabled ids', () => {
    const config = normalizeConfig({
      customSources: [
        { id: 'a', name: 'A', url: 'https://a.example.com/rss', category: 'world', language: 'en' },
        { id: 'b' }, // missing fields → dropped
        null,
      ],
      disabledSources: ['x', 7, 'y'],
    })
    expect(config.customSources).toHaveLength(1)
    expect(config.customSources[0]?.id).toBe('a')
    expect(config.disabledSources).toEqual(['x', 'y'])
  })

  it('honors valid option fields and clamps ttl', () => {
    const config = normalizeConfig({ imageProxy: false, ttlMinutes: 5000, summaryOnly: true, rsshubInstance: 'https://rsshub.local' })
    expect(config.imageProxy).toBe(false)
    expect(config.ttlMinutes).toBe(15) // out of range → default
    expect(config.summaryOnly).toBe(true)
    expect(config.rsshubInstance).toBe('https://rsshub.local')
  })
})

describe('localStorage persistence', () => {
  beforeEach(() => installLocalStorage())

  it('round-trips a config', () => {
    const config: typeof DEFAULT_CONFIG = {
      customSources: [{ id: 'u', name: 'U', url: 'https://u.example.com/feed', category: 'ai', language: 'zh', builtin: false }],
      disabledSources: ['bbc-world'],
      imageProxy: false,
      ttlMinutes: 30,
      summaryOnly: false,
    }
    saveConfig(config)
    expect(loadConfig()).toEqual(config)
  })

  it('falls back to defaults when storage is corrupt', () => {
    ;(globalThis.localStorage as Storage).setItem(CONFIG_KEY, '{not json')
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('falls back to defaults when storage is absent', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
  })
})
