/**
 * Sidebar entry injection.
 *
 * Follows the task-board/ssh family pattern: a plain-DOM row injected next
 * to the shell's New Session button, self-healing through a MutationObserver
 * (re-inserted in the same frame, before paint, so no flicker). The row
 * toggles the news modal through the shared controller and reflects the
 * open state with an active highlight.
 */
import type { NewsModalController } from './modal-controller.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NEWS_NS } from './locales.ts'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-news-entry]'

/** Inline icon (matches the shell's 16px nav-icon look). */
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3.5h7a2 2 0 0 1 2 2V12a1.5 1.5 0 0 1-1.5 1.5H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/><path d="M6 3.5V1.8M4.5 8h4M4.5 10.5h4M10.5 2.5l1.5-1"/></svg>`

/** Find the sidebar shell root element, or undefined while not yet mounted. */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** Build the entry row (a detached button; insert once the shell is up). */
function createEntry(controller: NewsModalController, t: TranslateNS<typeof NEWS_NS>): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshNewsEntry = ''
  entry.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'width:100%',
    'padding:8px 12px',
    'border:none',
    'background:transparent',
    'color:inherit',
    'font:inherit',
    'cursor:pointer',
    'border-radius:6px',
  ].join(';')
  entry.setAttribute('aria-label', t('entry.label'))
  entry.innerHTML = `<span style="display:inline-flex;flex:none">${ICON}</span><span>${t('entry.label')}</span>`
  entry.addEventListener('click', () => { controller.toggle() })
  return entry
}

/** Re-insert the entry after the New Session row (before the browser region). */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-dsh-news-entry], [data-dsh-taskboard-entry], [data-dsh-ssh-entry]'),
    )
    const anchor = family.length > 0 ? family[0] : base.nextElementSibling
    if (anchor !== undefined && anchor !== null) {
      root.insertBefore(entry, anchor)
    } else {
      root.appendChild(entry)
    }
  }
  return true
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the modal controller the entry toggles.
 * @param t - bound translation function (label reads the active locale).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: NewsModalController, t: TranslateNS<typeof NEWS_NS>): () => void {
  if (typeof document !== 'undefined' && document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {}
  }
  const entry = createEntry(controller, t)
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true })
    }
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry)
    }
  })

  // Reflect the modal's open state on the row (active highlight). Assigning
  // undefined to dataset.active materializes data-active="undefined" — delete
  // the attribute instead.
  const syncActive = (): void => {
    if (controller.isOpen()) entry.dataset.active = 'true'
    else delete entry.dataset.active
  }
  const unsubscribe = controller.subscribe(syncActive)
  syncActive()

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribe()
    entry.remove()
  }
}
