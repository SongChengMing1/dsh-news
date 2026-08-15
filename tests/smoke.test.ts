import { describe, expect, it } from 'vitest'
import { isNewsCategory, NEWS_CATEGORIES, type NewsCategory } from '../src/shared/types'

describe('shared categories', () => {
  it('defines the four built-in categories in display order', () => {
    expect(NEWS_CATEGORIES.map((c) => c.id)).toEqual(['world', 'ai', 'science', 'history'])
    for (const meta of NEWS_CATEGORIES) {
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('isNewsCategory accepts only known ids', () => {
    for (const id of NEWS_CATEGORIES.map((c) => c.id)) {
      expect(isNewsCategory(id)).toBe(true)
    }
    expect(isNewsCategory('sports')).toBe(false)
    expect(isNewsCategory(undefined)).toBe(false)
    expect(isNewsCategory('')).toBe(false)
  })

  it('category ids are stable wire vocabulary', () => {
    const ids = NEWS_CATEGORIES.map((c) => c.id) as NewsCategory[]
    // Unique and non-empty.
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})
