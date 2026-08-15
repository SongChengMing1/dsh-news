/**
 * Cache layer: an in-memory LRU plus an on-disk cache under
 * `~/.dsh/cache/dsh-news/` (URL-hash file names with metadata JSON and
 * expiry cleanup). Cache keys are namespaced by kind (`feed:`, `article:`,
 * `img:`) so one URL can be cached independently per route.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One memory cache entry. */
interface MemEntry<T> {
  value: T
  expiresAt: number
  /** Monotonic recency counter for LRU eviction. */
  tick: number
}

/** Simple capacity-bounded LRU with TTL. */
export class MemoryCache<T> {
  private readonly map = new Map<string, MemEntry<T>>()
  private tickCounter = 0

  constructor(private readonly capacity: number) {}

  /** Read an entry whose TTL (from its own expiry) is still valid. */
  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    entry.tick = ++this.tickCounter
    return entry.value
  }

  /** Store an entry with an absolute expiry (ms epoch). */
  set(key: string, value: T, expiresAt: number): void {
    const entry: MemEntry<T> = { value, expiresAt, tick: ++this.tickCounter }
    this.map.set(key, entry)
    if (this.map.size > this.capacity) {
      // Evict the least-recently-used entry.
      let oldestKey: string | undefined
      let oldestTick = Infinity
      for (const [k, v] of this.map) {
        if (v.tick < oldestTick) {
          oldestTick = v.tick
          oldestKey = k
        }
      }
      if (oldestKey !== undefined) this.map.delete(oldestKey)
    }
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }
}

/** Disk cache entry metadata. */
interface DiskMeta {
  /** Cache key (namespaced URL). */
  key: string
  /** Absolute expiry (ms epoch). */
  expiresAt: number
  /** Content-type for binary entries (images). */
  contentType?: string
}

/** Hash a cache key into a filesystem-safe name. */
export function cacheFileName(key: string): string {
  return createHash('sha1').update(key).digest('hex')
}

/** One route's disk cache (single directory). */
export class DiskCache {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
  }

  /** Full path of the payload file for a key. */
  private payloadPath(key: string): string {
    return join(this.dir, cacheFileName(key) + '.bin')
  }

  /** Full path of the metadata file for a key. */
  private metaPath(key: string): string {
    return join(this.dir, cacheFileName(key) + '.meta.json')
  }

  /** Read a cached payload whose TTL is still valid (undefined on miss). */
  read(key: string): { value: Buffer; contentType?: string } | undefined {
    let metaRaw: string
    try {
      metaRaw = readFileSync(this.metaPath(key), 'utf8')
    } catch {
      return undefined
    }
    let meta: DiskMeta
    try {
      meta = JSON.parse(metaRaw) as DiskMeta
    } catch {
      return undefined
    }
    if (meta.key !== key || meta.expiresAt <= Date.now()) {
      // Stale or mismatched — drop it.
      this.remove(key)
      return undefined
    }
    try {
      const value = readFileSync(this.payloadPath(key))
      return { value, contentType: meta.contentType }
    } catch {
      return undefined
    }
  }

  /** Write a payload with an absolute expiry (ms epoch). */
  write(key: string, value: Buffer, expiresAt: number, contentType?: string): void {
    const meta: DiskMeta = { key, expiresAt, contentType }
    writeFileSync(this.metaPath(key), JSON.stringify(meta), 'utf8')
    writeFileSync(this.payloadPath(key), value)
  }

  /** Remove a key's files (idempotent). */
  remove(key: string): void {
    for (const path of [this.metaPath(key), this.payloadPath(key)]) {
      try {
        rmSync(path, { force: true })
      } catch {
        // best effort
      }
    }
  }

  /** Delete every expired entry (startup + periodic sweep). */
  sweep(): number {
    let removed = 0
    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return 0
    }
    for (const file of files) {
      if (!file.endsWith('.meta.json')) continue
      const path = join(this.dir, file)
      try {
        const meta = JSON.parse(readFileSync(path, 'utf8')) as DiskMeta
        const payload = join(this.dir, file.replace(/\.meta\.json$/, '.bin'))
        if (meta.expiresAt <= Date.now()) {
          rmSync(path, { force: true })
          rmSync(payload, { force: true })
          removed++
        } else {
          // Touch-free existence sanity: drop orphaned metadata.
          if (!exists(payload)) rmSync(path, { force: true })
        }
      } catch {
        // Unparseable metadata — remove it.
        rmSync(path, { force: true })
        removed++
      }
    }
    return removed
  }
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}
