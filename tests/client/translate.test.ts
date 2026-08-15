/**
 * Client translation helper tests: target language mapping and card
 * title+summary translation. Global fetch is stubbed so no network or Host
 * is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { targetLanguageFor, translateCardTexts } from '../../src/client/translate'

/** Stub fetch: /news/translate echoes "译:" + requested text back. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const calls: Array<{ text: string; to: string }> = []
  const mock = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input)
    expect(url).toBe('/news/translate')
    const body = JSON.parse(init?.body ?? '{}') as { text?: string; to?: string }
    calls.push({ text: body.text ?? '', to: body.to ?? '' })
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: `译:${body.text ?? ''}`, detected: 'en', cached: false }),
    }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('targetLanguageFor', () => {
  it('maps the zh GUI to zh-CN and en GUI to en', () => {
    expect(targetLanguageFor('zh')).toBe('zh-CN')
    expect(targetLanguageFor('en')).toBe('en')
    expect(targetLanguageFor('de')).toBe('zh-CN') // unknown locales fall back to zh-CN
  })
})

describe('translateCardTexts', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates title and summary in two parallel requests', async () => {
    const fetchMock = stubFetch()
    const result = await translateCardTexts('Hello', 'World summary', 'zh-CN')
    expect(result.title).toBe('译:Hello')
    expect(result.summary).toBe('译:World summary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips the summary request when the summary is empty', async () => {
    const fetchMock = stubFetch()
    const result = await translateCardTexts('Hello', '', 'zh-CN')
    expect(result.title).toBe('译:Hello')
    expect(result.summary).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await expect(translateCardTexts('Hello', 'Summary', 'zh-CN')).rejects.toThrow(/500/)
  })
})
