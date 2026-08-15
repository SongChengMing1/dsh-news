/**
 * Free translation via the unofficial Google Translate endpoint
 * (`translate.googleapis.com/translate_a/single`, client=gtx — no API key).
 *
 * The endpoint accepts a single q= parameter, so long texts are split into
 * byte-aware chunks (paragraph-preserving, sized by encoded length so CJK
 * payloads cannot blow the URL limit). Chunks run through the shared
 * fetcher (SSRF pinning + timeout + retry) under the global limiter, and
 * results are cached (memory + disk, 24h) keyed by target language + text
 * hash, so re-reading an article never re-translates it.
 *
 * This is an unofficial, best-effort service: failures surface as
 * FetchError and the route degrades to a 502 the Client renders inline.
 */
import { createHash } from 'node:crypto'
import { DiskCache, MemoryCache } from './cache.ts'
import { FetchError, fetchWithRetry, globalLimiter } from './fetcher.ts'

/** Google Translate unofficial endpoint. */
const GTX_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

/** Cache TTL for translations (ms). */
export const TRANSLATE_TTL = 24 * 60 * 60 * 1000

/**
 * Per-chunk cap measured in encoded (UTF-8 byte) length, keeping the GET
 * request line well under typical 8 KiB server limits. CJK text encodes to
 * 3 bytes/char, so this yields ~2000 CJK or ~6000 latin chars per chunk.
 */
export const CHUNK_MAX_ENCODED = 6000

/** One translation outcome (also the wire shape of /news/translate). */
export interface TranslateResult {
  text: string
  /** Source language detected by the service (e.g. "en", "zh-CN"). */
  detected?: string
  /** True when served from cache. */
  cached: boolean
}

/** UTF-8 byte length of a string (approximates the URL-encoded size). */
function encodedLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    bytes += value.charCodeAt(i) < 128 ? 1 : 3
  }
  return bytes
}

/** Hard-split an over-long paragraph on sentence boundaries, then bytes. */
function splitLongParagraph(paragraph: string, maxEncoded: number): string[] {
  const parts: string[] = []
  const sentences = paragraph.split(/(?<=[。！？!?；;])/)
  for (const sentence of sentences) {
    if (sentence === '') continue
    if (encodedLength(sentence) <= maxEncoded) {
      parts.push(sentence)
      continue
    }
    // No boundary available — cut on bytes, never splitting surrogate pairs.
    let rest = sentence
    while (encodedLength(rest) > maxEncoded) {
      let cut = Math.floor(maxEncoded / 3)
      while (cut > 0 && encodedLength(rest.slice(0, cut)) > maxEncoded) cut--
      if (cut <= 0) break
      parts.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    if (rest !== '') parts.push(rest)
  }
  return parts
}

/**
 * Split text into translation chunks: paragraphs (blank-line separated)
 * accumulate joined by blank lines until the encoded length cap is reached;
 * a single oversized paragraph is broken on sentence boundaries first, then
 * by bytes. Blank lines are soft separators — the '\n\n' joiner keeps
 * paragraph structure inside one chunk.
 */
export function chunkText(text: string, maxEncoded = CHUNK_MAX_ENCODED): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized === '') return []
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim() !== '') chunks.push(current.trim())
    current = ''
  }
  for (const raw of normalized.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    const candidate = current === '' ? trimmed : `${current}\n\n${trimmed}`
    if (current !== '' && encodedLength(candidate) > maxEncoded) {
      flush()
    }
    if (encodedLength(trimmed) > maxEncoded) {
      for (const piece of splitLongParagraph(trimmed, maxEncoded)) {
        if (current !== '' && encodedLength(`${current}\n\n${piece}`) > maxEncoded) flush()
        current = current === '' ? piece : `${current}\n\n${piece}`
      }
    } else if (current === '') {
      current = trimmed
    } else {
      current = candidate
    }
  }
  flush()
  return chunks
}

/**
 * Parse the gtx JSON response: `[[["translated","original",...],...],null,
 * "detectedLang",...]` — the translated text is the concat of segment[0],
 * the detected language sits at index 2.
 */
export function parseGtxResponse(body: string): { text: string; detected?: string } {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new FetchError('PARSE', 'invalid translation response')
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new FetchError('PARSE', 'invalid translation response')
  }
  let text = ''
  for (const segment of data[0] as unknown[]) {
    if (Array.isArray(segment) && typeof segment[0] === 'string') text += segment[0]
  }
  if (text === '') {
    throw new FetchError('EMPTY', 'empty translation response')
  }
  const detected = typeof data[2] === 'string' && data[2] !== '' ? data[2] : undefined
  return { text, detected }
}

/** Translate one chunk through the gtx endpoint (no caching). */
async function translateChunk(text: string, to: string): Promise<{ text: string; detected?: string }> {
  const url = new URL(GTX_ENDPOINT)
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', 'auto')
  url.searchParams.set('tl', to)
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', text)
  const response = await fetchWithRetry(url, { timeoutMs: 15000, maxBytes: 1024 * 1024 })
  if (response.status !== 200) {
    throw new FetchError('HTTP', `translation service returned ${response.status}`)
  }
  return parseGtxResponse(response.body.toString('utf8'))
}

/**
 * Translate a text (auto-detected source) into the target language,
 * chunking long inputs, running chunks through the shared limiter, and
 * caching the joined result (memory + disk, 24h).
 * @param text - the text to translate.
 * @param to - target language code (e.g. "zh-CN", "en").
 * @param mem - in-memory translation cache.
 * @param disk - on-disk translation cache.
 * @throws FetchError for empty input / upstream failures.
 */
export async function translateText(
  text: string,
  to: string,
  mem: MemoryCache<TranslateResult>,
  disk: DiskCache,
): Promise<TranslateResult> {
  const key = `tr:${to}:${createHash('sha1').update(text).digest('hex')}`
  let cached = mem.get(key)
  if (cached === undefined) {
    const diskEntry = disk.read(key)
    if (diskEntry !== undefined) {
      try {
        cached = JSON.parse(diskEntry.value.toString('utf8')) as TranslateResult
      } catch {
        cached = undefined
      }
    }
  }
  if (cached !== undefined) {
    return { ...cached, cached: true }
  }
  const chunks = chunkText(text)
  if (chunks.length === 0) {
    throw new FetchError('EMPTY', 'no translatable text')
  }
  const results = await Promise.all(chunks.map((chunk) => globalLimiter.run(() => translateChunk(chunk, to))))
  const result: TranslateResult = {
    text: results.map((r) => r.text).join('\n\n'),
    detected: results.find((r) => r.detected !== undefined)?.detected,
    cached: false,
  }
  const expiresAt = Date.now() + TRANSLATE_TTL
  mem.set(key, result, expiresAt)
  disk.write(key, Buffer.from(JSON.stringify(result), 'utf8'), expiresAt)
  return result
}
