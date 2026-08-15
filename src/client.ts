/**
 * dsh-news Client half.
 *
 * Milestone M1 skeleton: a placeholder sidebar entry row (plain DOM, no
 * React tree) injected next to the shell's New Session button, with the
 * MutationObserver self-heal pattern proven by the task-board/ssh family.
 * Clicking the entry logs for now; milestone M3 replaces the body with the
 * modal (list / reading / settings views).
 */
import type { Context } from '@deepseek-ai/cordis'

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
function createEntry(): HTMLButtonElement {
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
  entry.setAttribute('aria-label', '新闻 / News')
  entry.innerHTML = `<span style="display:inline-flex;flex:none">${ICON}</span><span>新闻 / News</span>`
  entry.addEventListener('click', () => {
    // M3: toggle the news modal.
    console.log('[dsh-news] entry clicked (placeholder)')
  })
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
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(): () => void {
  if (typeof document !== 'undefined' && document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {}
  }
  const entry = createEntry()
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

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    entry.remove()
  }
}

export const inject: string[] = []

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  try {
    ctx.effect(() => mountSidebarEntry(), 'dsh-news: sidebar entry')
  } catch (error) {
    // DOM failures degrade the entry, never the GUI.
    console.error('[dsh-news] sidebar mount failed:', error)
  }
}
