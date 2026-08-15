/**
 * translate module tests: byte-aware chunking, gtx response parsing, and
 * chunked translation with caching. The network-facing fetcher is mocked so
 * no external requests are made.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiskCache, MemoryCache } from '../../src/host/cache'
import { FetchError } from '../../src/host/fetcher'
import { chunkText, parseGtxResponse, translateText } from '../../src/host/translate'

vi.mock('../../src/host/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/fetcher')>()
  return { ...actual, fetchWithRetry: vi.fn() }
})

import { fetchWithRetry } from '../../src/host/fetcher'

function gtxBody(translated: string, detected = 'en'): string {
  // Real gtx shape: data[0] = [[translated, original, ...], ...].
  return JSON.stringify([translated.split('\n').map((line) => [line, line]), null, detected])
}

describe('chunkText', () => {
  it('returns [] for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n  ')).toEqual([])
  })

  it('keeps small texts as a single chunk', () => {
    expect(chunkText('Hello world.')).toEqual(['Hello world.'])
  })

  it('preserves paragraph structure inside one chunk', () => {
    expect(chunkText('First para.\n\nSecond para.')).toEqual(['First para.\n\nSecond para.'])
  })

  it('splits paragraphs across chunks when the cap is exceeded', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i} with some padding words.`).join('\n\n')
    const chunks = chunkText(text, 400)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(400)
    }
    // Rejoining chunks must reconstruct every paragraph.
    const joined = chunks.join('\n\n')
    expect(joined).toContain('Paragraph number 0')
    expect(joined).toContain('Paragraph number 29')
  })

  it('hard-splits an oversized CJK paragraph by bytes', () => {
    const long = '中'.repeat(3000) // 9000 UTF-8 bytes > 6000 cap
    const chunks = chunkText(long, 6000)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe('中'.repeat(2000))
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(6000)
    }
  })

  it('splits long paragraphs on sentence boundaries first', () => {
    const long = '第一句。第二句。第三句。' + '啊'.repeat(4000)
    const chunks = chunkText(long, 6000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0] ?? '').toContain('第三句')
  })

  it('normalizes CRLF line endings', () => {
    expect(chunkText('A\r\n\r\nB')).toEqual(['A\n\nB'])
  })
})

describe('parseGtxResponse', () => {
  it('parses a valid gtx payload and extracts the detected language', () => {
    const result = parseGtxResponse(gtxBody('你好', 'en'))
    expect(result.text).toBe('你好')
    expect(result.detected).toBe('en')
  })

  it('concatenates multi-segment responses', () => {
    const body = JSON.stringify([[['one', 'one'], ['two', 'two']], null, 'en'])
    expect(parseGtxResponse(body).text).toBe('onetwo')
  })

  it('rejects malformed and empty payloads', () => {
    expect(() => parseGtxResponse('not json')).toThrow(FetchError)
    expect(() => parseGtxResponse(JSON.stringify({ ok: true }))).toThrow(FetchError)
    expect(() => parseGtxResponse(JSON.stringify([[['', '']], null, 'en']))).toThrow(FetchError)
  })
})

describe('translateText', () => {
  let cacheDir: string
  let mem: MemoryCache<{ text: string; detected?: string; cached: boolean }>
  let disk: DiskCache

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'dsh-news-translate-'))
    mem = new MemoryCache(10)
    disk = new DiskCache(join(cacheDir, 'translations'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('translates chunked text and joins the results', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://translate.googleapis.com/translate_a/single',
      status: 200,
      headers: {},
      body: Buffer.from(gtxBody('你好世界')),
    })
    const result = await translateText('Hello world.', 'zh-CN', mem, disk)
    expect(result.text).toBe('你好世界')
    expect(result.cached).toBe(false)
    expect(fetchWithRetry).toHaveBeenCalledTimes(1)
    const url = vi.mocked(fetchWithRetry).mock.calls[0]?.[0] as URL
    expect(url.searchParams.get('client')).toBe('gtx')
    expect(url.searchParams.get('sl')).toBe('auto')
    expect(url.searchParams.get('tl')).toBe('zh-CN')
    expect(url.searchParams.get('q')).toBe('Hello world.')
  })

  it('serves the second identical request from cache', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://translate.googleapis.com/translate_a/single',
      status: 200,
      headers: {},
      body: Buffer.from(gtxBody('你好')),
    })
    const first = await translateText('Hello', 'zh-CN', mem, disk)
    const second = await translateText('Hello', 'zh-CN', mem, disk)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.text).toBe('你好')
    expect(fetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('uses separate cache entries per target language', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://translate.googleapis.com/translate_a/single',
      status: 200,
      headers: {},
      body: Buffer.from(gtxBody('你好')),
    })
    await translateText('Hello', 'zh-CN', mem, disk)
    await translateText('Hello', 'en', mem, disk)
    expect(fetchWithRetry).toHaveBeenCalledTimes(2)
  })

  it('rejects empty text', async () => {
    await expect(translateText('   ', 'zh-CN', mem, disk)).rejects.toThrow(FetchError)
  })

  it('surfaces upstream HTTP failures', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      url: 'https://translate.googleapis.com/translate_a/single',
      status: 429,
      headers: {},
      body: Buffer.from('rate limited'),
    })
    await expect(translateText('Hello', 'zh-CN', mem, disk)).rejects.toThrow(/429/)
  })
})
