import { describe, expect, it } from 'vitest'
import { decodeProxiedImage } from '../../src/client/modal/ReadingView'

describe('decodeProxiedImage', () => {
  it('decodes a proxied image path back to the original URL', () => {
    const original = 'https://cdn.example.com/a/b.jpg?w=800'
    const proxied = `/news/img?u=${encodeURIComponent(original)}`
    expect(decodeProxiedImage(proxied)).toBe(original)
  })

  it('handles full absolute proxy URLs (fetch resolves relative paths)', () => {
    const original = 'https://cdn.example.com/p.png'
    const proxied = `http://127.0.0.1:8080/news/img?u=${encodeURIComponent(original)}`
    expect(decodeProxiedImage(proxied)).toBe(original)
  })

  it('returns undefined for non-proxy srcs and malformed encodings', () => {
    expect(decodeProxiedImage('https://cdn.example.com/direct.jpg')).toBeUndefined()
    expect(decodeProxiedImage('data:image/png;base64,abc')).toBeUndefined()
    expect(decodeProxiedImage('/news/img?u=%E0%A4%A')).toBeUndefined() // truncated encoding
    expect(decodeProxiedImage('')).toBeUndefined()
  })
})
