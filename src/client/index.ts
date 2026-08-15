/**
 * dsh-news Client half.
 *
 * Wires the framework-free pieces (modal controller, feed state, config
 * store) to the real client runtime: registers the locale dictionaries,
 * injects the sidebar entry row and mounts the modal React root.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: activates Context.locale and the LocaleNamespaceMap merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { NewsModalController } from './modal-controller.ts'
import { mountModal } from './modal-mount.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { en, NEWS_NS, zh, type NewsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-news surface copy. */
    news: NewsKey
  }
}

/** Cross-module-instance apply guard (see task-board apply-guard pattern). */
declare global {
  // eslint-disable-next-line no-var
  var __dshNewsApplied: boolean | undefined
}

/** Claims the plugin apply slot; first claim wins per page lifetime. */
export function claimNewsApply(): boolean {
  if (globalThis.__dshNewsApplied === true) return false
  globalThis.__dshNewsApplied = true
  return true
}

/** Releases the claim (fiber unload / hot reload can claim again). */
export function releaseNewsApply(): void {
  globalThis.__dshNewsApplied = undefined
}

/** Required services: the locale runtime (i18n). */
export const inject = ['locale']

/**
 * Client plugin body.
 * @param ctx - client root context (locale injected).
 */
export function apply(ctx: Context): void {
  if (!claimNewsApply()) return
  ctx.effect(() => releaseNewsApply, 'dsh-news: apply claim')

  ctx.effect(() => ctx.locale.register(NEWS_NS, { zh, en }), 'dsh-news: dictionaries')
  const t = ctx.locale.bind(NEWS_NS)

  const controller = new NewsModalController()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller, t))
    disposers.push(mountModal(controller, t, {
      getRevision: () => ctx.locale.getSnapshot().revision,
      subscribe: (fn) => ctx.locale.subscribe(fn),
      getLocale: () => ctx.locale.getSnapshot().active,
    }))
  } catch (error) {
    // DOM failures degrade the entry/modal, never the GUI.
    console.error('[dsh-news] mount failed:', error)
  }
  const disposeUi = (): void => {
    for (const dispose of disposers.splice(0)) dispose()
  }
  ctx.effect(() => disposeUi, 'dsh-news: ui disposers')
}
