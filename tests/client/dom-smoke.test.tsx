// @vitest-environment jsdom
/**
 * Client DOM smoke tests: simulate the shell's sidebar structure and verify
 * the entry injection (self-heal included) and the modal mount lifecycle
 * without a real GUI.
 */
import { afterEach, describe, expect, it } from 'vitest'
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
})
