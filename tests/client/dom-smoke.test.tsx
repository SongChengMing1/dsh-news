// @vitest-environment jsdom
/**
 * Client DOM smoke tests: simulate the shell's sidebar structure and verify
 * the entry injection (self-heal included) and the modal mount lifecycle
 * without a real GUI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSidebarEntry, ENTRY_SELECTOR } from '../../src/client/sidebar-entry'
import { mountModal, MODAL_SELECTOR } from '../../src/client/modal-mount'
import { NewsModalController } from '../../src/client/modal-controller'
import { zh } from '../../src/client/locales'

/** Mock translate: resolves through the zh dictionary. */
function mockT(key: string, params?: Record<string, string>): string {
  let text = (zh as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, value)
    }
  }
  return text
}

/** Wait a tick so React renders async updates. */
function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fake Response-ish object for fetch stubs. */
function jsonResponse(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** Stub fetch to serve the feed, article and translate routes. */
function stubHost(options: { failTranslations?: number } = {}): ReturnType<typeof vi.fn> {
  let translateFailuresLeft = options.failTranslations ?? 0
  const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input)
    if (url === '/news/feed') {
      return jsonResponse({
        items: [{
          title: 'Hello AI',
          summary: 'AI is changing the world.',
          link: 'https://example.com/a',
          pubDate: '2025-08-13T10:00:00Z',
          source: { id: 's1', name: 'Src', category: 'ai' },
        }],
        sources: [],
        fetchedAt: new Date().toISOString(),
        cached: false,
      })
    }
    if (url.startsWith('/news/article')) {
      return jsonResponse({
        url: 'https://example.com/a',
        title: 'Hello AI',
        contentHtml: '<p>First paragraph.</p><p>Second paragraph.</p>',
        link: 'https://example.com/a',
        cached: false,
      })
    }
    if (url === '/news/translate') {
      if (translateFailuresLeft > 0) {
        translateFailuresLeft--
        return jsonResponse({ error: 'rate limited' }, 502)
      }
      const body = JSON.parse(init?.body ?? '{}') as { text?: string; to?: string }
      return jsonResponse({ text: `译:${body.text ?? ''}`, detected: 'en', cached: false })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Open the modal, wait for the feed to render, and return the container. */
async function openWithFeed(): Promise<HTMLElement> {
  buildShell()
  const controller = new NewsModalController()
  const dispose = mountModal(controller, mockT as never, {
    getRevision: () => 0,
    subscribe: () => () => {},
    getLocale: () => 'zh',
  })
  const container = document.querySelector<HTMLElement>(MODAL_SELECTOR)
  expect(container).not.toBeNull()
  controller.openModal()
  await tick(40)
  return container as HTMLElement
}

/** Find the first button whose text matches exactly. */
function findButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)
}

/** Build a fake shell DOM (sidebar column + logo row + New Session button). */
function buildShell(): { root: HTMLElement; column: HTMLElement } {
  document.body.innerHTML = ''
  const column = document.createElement('div')
  column.setAttribute('data-pane', 'sidebar')
  const wrapper = document.createElement('div')
  const logoRow = document.createElement('div')
  logoRow.className = 'logoRow'
  const newSession = document.createElement('button')
  newSession.className = 'newSession'
  newSession.textContent = 'New Session'
  logoRow.appendChild(newSession)
  wrapper.appendChild(logoRow)
  column.appendChild(wrapper)
  document.body.appendChild(column)
  return { root: wrapper, column }
}

afterEach(() => {
  vi.unstubAllGlobals()
  // The master switch persists to localStorage via saveConfig — reset it so
  // tests never inherit the previous test's translation state.
  window.localStorage.clear()
  document.body.innerHTML = ''
})

describe('sidebar entry', () => {
  it('injects the entry next to the New Session button and toggles active state', () => {
    const { root } = buildShell()
    const controller = new NewsModalController()
    const dispose = mountSidebarEntry(controller, mockT as never)

    const entry = root.querySelector<HTMLButtonElement>(ENTRY_SELECTOR)
    expect(entry).not.toBeNull()
    expect(entry?.textContent).toContain('新闻')

    // Toggle opens the modal → active highlight.
    controller.openModal()
    expect(entry?.dataset.active).toBe('true')
    controller.close()
    expect(entry?.dataset.active).toBeUndefined()

    dispose()
    expect(document.querySelector(ENTRY_SELECTOR)).toBeNull()
  })

  it('self-heals when the shell re-renders (entry displaced)', () => {
    const { root } = buildShell()
    const controller = new NewsModalController()
    const dispose = mountSidebarEntry(controller, mockT as never)

    // Simulate a shell re-render that tears the sidebar down and rebuilds it.
    const rebuilt = document.createElement('div')
    rebuilt.className = 'logoRow'
    const newSession = document.createElement('button')
    newSession.className = 'newSession'
    rebuilt.appendChild(newSession)
    root.innerHTML = ''
    root.appendChild(rebuilt)

    // MutationObserver fires asynchronously; wait a tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const entry = root.querySelector<HTMLButtonElement>(ENTRY_SELECTOR)
        expect(entry).not.toBeNull()
        dispose()
        resolve()
      }, 20)
    })
  })

  it('does not duplicate the entry on double mount', () => {
    buildShell()
    const controller = new NewsModalController()
    const first = mountSidebarEntry(controller, mockT as never)
    const second = mountSidebarEntry(controller, mockT as never)
    expect(document.querySelectorAll(ENTRY_SELECTOR)).toHaveLength(1)
    first()
    second()
  })
})

describe('modal mount', () => {
  it('renders the modal on open and hides on close', () => {
    buildShell()
    const controller = new NewsModalController()
    const dispose = mountModal(controller, mockT as never, {
      getRevision: () => 0,
      subscribe: () => () => {},
      getLocale: () => 'zh',
    })

    const container = document.querySelector<HTMLElement>(MODAL_SELECTOR)
    expect(container).not.toBeNull()

    // Closed: React renders the hidden placeholder (async).
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(container?.querySelector('[data-dsh-news-modal-hidden]')).not.toBeNull()

        controller.openModal()
        // React renders asynchronously; wait a tick.
        setTimeout(() => {
          expect(container?.textContent).toContain('新闻聚合')

          controller.close()
          setTimeout(() => {
            expect(container?.textContent).not.toContain('新闻聚合')
            dispose()
            expect(document.querySelector(MODAL_SELECTOR)).toBeNull()
            resolve()
          }, 20)
        }, 20)
      }, 20)
    })
  })

  it('auto-translates visible cards from the master switch and restores on off', async () => {
    stubHost()
    const container = await openWithFeed()

    // Cards start untranslated; the master switch sits above the list.
    expect(container.textContent).toContain('Hello AI')
    expect(container.textContent).not.toContain('译:')
    const master = findButton(container, '翻译列表')
    expect(master).not.toBeUndefined()

    // Master switch on → every rendered card translates automatically
    // (jsdom has no IntersectionObserver, so the one-pass fallback runs).
    master?.click()
    await tick(60)
    expect(container.textContent).toContain('译:Hello AI')
    expect(container.textContent).toContain('译:AI is changing the world.')

    // Master switch off → original texts come back.
    const off = findButton(container, '关闭翻译')
    expect(off).not.toBeUndefined()
    off?.click()
    await tick(40)
    expect(container.textContent).toContain('Hello AI')
    expect(container.textContent).not.toContain('译:')
  })

  it('shows a retry action when a card translation fails', async () => {
    stubHost({ failTranslations: 2 }) // title + summary of the single card
    const container = await openWithFeed()

    findButton(container, '翻译列表')?.click()
    await tick(60)
    expect(container.textContent).toContain('重试')

    // Retry succeeds and the card renders the translation.
    findButton(container, '重试')?.click()
    await tick(60)
    expect(container.textContent).toContain('译:Hello AI')
  })

  it('translates the reading view title and body together', async () => {
    stubHost()
    const container = await openWithFeed()

    // Open the article.
    container.querySelector<HTMLElement>('[role="button"]')?.click()
    await tick(40)
    expect(container.textContent).toContain('First paragraph.')

    // 翻译全文 translates title + body (one body request, paragraphs kept).
    const translateFull = findButton(container, '翻译全文')
    expect(translateFull).not.toBeUndefined()
    translateFull?.click()
    await tick(40)
    expect(container.textContent).toContain('译:Hello AI')
    expect(container.textContent).toContain('译:First paragraph.')
    expect(container.textContent).toContain('Second paragraph.')

    // 显示原文 flips back.
    const showOriginal = findButton(container, '显示原文')
    expect(showOriginal).not.toBeUndefined()
    showOriginal?.click()
    await tick(40)
    expect(container.textContent).toContain('First paragraph.')
    expect(container.textContent).not.toContain('译:')
  })

  it('auto-translates the opened article when the list switch is on', async () => {
    stubHost()
    const container = await openWithFeed()

    // Enable the master switch in the list first.
    findButton(container, '翻译列表')?.click()
    await tick(40)

    // Open the article — translation fires by itself (no manual click).
    container.querySelector<HTMLElement>('[role="button"]')?.click()
    await tick(60)
    expect(container.textContent).toContain('译:Hello AI')
    expect(container.textContent).toContain('译:First paragraph.')

    // The toggle is available to flip back to the original.
    const showOriginal = findButton(container, '显示原文')
    expect(showOriginal).not.toBeUndefined()
  })
})
