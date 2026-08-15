/**
 * Modal mounting: a body-level React root (the shell has no slot for modal
 * overlays, so the root is owned at the DOM level, exactly like the sidebar
 * entry). The root stays mounted for the plugin's lifetime; visibility is
 * driven by the controller, so list scroll and settings drafts survive
 * close/reopen.
 */
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NewsModalController } from './modal-controller.ts'
import { NewsApp } from './modal/App.tsx'
import { NEWS_NS } from './locales.ts'

/** The injected modal container. */
export const MODAL_SELECTOR = '[data-dsh-news-modal]'

/** Locale revision reader for re-render on locale switch. */
export interface LocaleRevisionFace {
  getRevision: () => number
  subscribe: (fn: () => void) => () => void
  /** Read the active GUI locale id at call time (drives translation target). */
  getLocale: () => string
}

/**
 * Mount the modal root into the body.
 * @param controller - open/close state owner.
 * @param t - bound translation function for the news namespace.
 * @param locale - revision face (locale switch re-renders the modal).
 * @returns disposer unmounting the tree.
 */
export function mountModal(
  controller: NewsModalController,
  t: TranslateNS<typeof NEWS_NS>,
  locale: LocaleRevisionFace,
): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(MODAL_SELECTOR) !== null) return () => {}

  const container = document.createElement('div')
  container.dataset.dshNewsModal = ''
  document.body.appendChild(container)

  let root: Root | undefined
  try {
    root = createRoot(container)
    root.render(createElement(NewsApp, {
      controller,
      t,
      getLocaleRevision: locale.getRevision,
      subscribeLocale: locale.subscribe,
      getLocale: locale.getLocale,
    }))
  } catch (error) {
    console.error('[dsh-news] modal mount failed:', error)
    container.remove()
    return () => {}
  }

  return () => {
    root?.unmount()
    root = undefined
    container.remove()
  }
}
