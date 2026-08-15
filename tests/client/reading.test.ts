import { describe, expect, it } from 'vitest'
import { decodeProxiedImage, htmlToText } from '../../src/client/modal/ReadingView'

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

describe('htmlToText', () => {
  it('converts paragraphs into blank-line breaks and br into newlines', () => {
    const html = '<p>First line.</p><p>Second <b>bold</b> line.</p><br>Tail.'
    // A <br> directly after </p> collapses into the paragraph break.
    expect(htmlToText(html)).toBe('First line.\n\nSecond bold line.\n\nTail.')
  })

  it('decodes common HTML entities', () => {
    expect(htmlToText('<p>A &amp; B &lt;tag&gt; &quot;quote&quot; &#39;apos&#39; &nbsp;end</p>'))
      .toBe('A & B <tag> "quote" \'apos\'  end')
  })

  it('collapses blank runs and trims edges', () => {
    const html = '<div>  <p>One</p>\n\n\n<p>Two</p>  </div>'
    expect(htmlToText(html)).toBe('One\n\nTwo')
  })

  it('returns empty string for tag-only content', () => {
    expect(htmlToText('<div><img src="x.png"></div>')).toBe('')
  })
})
