import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheFileName, DiskCache, MemoryCache } from '../../src/host/cache'

describe('MemoryCache (LRU + TTL)', () => {
  it('stores and reads within TTL', () => {
    const cache = new MemoryCache<string>(10)
    cache.set('a', 'value', Date.now() + 1000)
    expect(cache.get('a')).toBe('value')
  })

  it('expires entries after TTL', () => {
    const cache = new MemoryCache<string>(10)
    cache.set('a', 'value', Date.now() - 1)
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the least recently used entry beyond capacity', () => {
    const cache = new MemoryCache<string>(2)
    cache.set('a', '1', Date.now() + 1000)
    cache.set('b', '2', Date.now() + 1000)
    cache.get('a') // refresh recency
    cache.set('c', '3', Date.now() + 1000) // evicts b
    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('3')
    expect(cache.size).toBe(2)
  })
})

describe('DiskCache', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-news-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes and reads payloads with metadata', () => {
    const cache = new DiskCache(dir)
    cache.write('feed:https://a/x', Buffer.from('{"a":1}'), Date.now() + 60_000, undefined)
    const hit = cache.read('feed:https://a/x')
    expect(hit?.value.toString('utf8')).toBe('{"a":1}')
  })

  it('preserves content-type for binary entries', () => {
    const cache = new DiskCache(dir)
    cache.write('img:https://a/p.png', Buffer.from([1, 2, 3]), Date.now() + 60_000, 'image/png')
    const hit = cache.read('img:https://a/p.png')
    expect(hit?.contentType).toBe('image/png')
  })

  it('misses on expired entries and removes their files', () => {
    const cache = new DiskCache(dir)
    cache.write('k', Buffer.from('x'), Date.now() - 1)
    expect(cache.read('k')).toBeUndefined()
    // The expired entry's files are cleaned up lazily on read.
    const metaFile = join(dir, cacheFileName('k') + '.meta.json')
    expect(() => readFileSync(metaFile)).toThrow()
  })

  it('survives across instances (persistence)', () => {
    const cache = new DiskCache(dir)
    cache.write('k2', Buffer.from('persisted'), Date.now() + 60_000)
    const other = new DiskCache(dir)
    expect(other.read('k2')?.value.toString('utf8')).toBe('persisted')
  })

  it('sweep removes expired entries only', () => {
    const cache = new DiskCache(dir)
    cache.write('expired', Buffer.from('x'), Date.now() - 1)
    cache.write('fresh', Buffer.from('y'), Date.now() + 60_000)
    const removed = cache.sweep()
    expect(removed).toBe(1)
    expect(cache.read('expired')).toBeUndefined()
    expect(cache.read('fresh')?.value.toString('utf8')).toBe('y')
  })

  it('sweep removes orphaned metadata (no payload)', () => {
    const cache = new DiskCache(dir)
    // Write only a metadata file, no payload — simulates a partial write.
    const metaFile = join(dir, cacheFileName('orphan') + '.meta.json')
    writeFileSync(metaFile, JSON.stringify({ key: 'orphan', expiresAt: Date.now() + 60_000 }), 'utf8')
    cache.sweep()
    expect(() => readFileSync(metaFile)).toThrow()
  })
})
