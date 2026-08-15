/**
 * dsh-news Host half.
 *
 * Registers the /news/* webserver routes (feed aggregation, article
 * extraction, image proxy — see routes.ts) and the system-prompt
 * announcement section (announceToAgent, editable through the web settings
 * surface via dsh-settings), following the task-board pattern.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
// Type-only: activates the Context.systemPrompt / Context.webServer merges.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { createRouteCaches, makeRoutes } from './host/routes.ts'

// Re-export shared vocabulary for package consumers and tooling.
export { BUILTIN_SOURCES, findBuiltinSource } from './shared/sources.ts'
export { NEWS_CATEGORIES, isNewsCategory } from './shared/types.ts'
export type { ArticleResponse, FeedResponse, NewsCategory, NewsItem, NewsSource } from './shared/types.ts'
export { createRouteCaches, makeRoutes } from './host/routes.ts'
export { DiskCache, MemoryCache } from './host/cache.ts'
export { fetchFeed } from './host/rss.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200

/** Settings namespace of the announcement capability. */
const NEWS_SETTINGS_NAMESPACE = settingsNamespace('news')

const Config = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/** Model-facing announcement: plugin presence, capabilities, and limits. */
const NEWS_GUIDANCE =
  '本机已安装 dsh-news 插件（DSH Web GUI 新闻聚合）：侧边栏「新闻 / News」入口，弹窗聚合浏览国际新闻、知识科普、历史科普、AI 大模型新闻。能力：RSS 抓取解析（内置 17 个公开源，可自定义）、正文站内阅读（Readability 提取 + 白名单清洗）、图片代理（防盗链）、内存 + 磁盘缓存（feed 15 分钟 / 正文 24 小时 / 图片 7 天）、SSRF 防护与并发限流。限制：列表与正文仅为临时阅读缓存，不做永久存档或再分发；部分源可能因站方改版或反爬暂时失败，可在设置中禁用。用户提到「新闻 / News / 看新闻」时即指本插件，请引导用户在侧边栏「新闻」入口查看。'

/** Default cache root under the user's home. */
export function defaultCacheDir(): string {
  return join(homedir(), '.dsh', 'cache', 'dsh-news')
}/** Required services (fiber inject waiting). */
export const inject = ['webServer', 'systemPrompt']

/**
 * Host plugin body.
 * @param ctx - host plugin context (webServer, systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by loader).
 */
export function apply(ctx: Context, config?: { announceToAgent?: boolean; enabled?: boolean }): void {
  // --- /news/* routes ---
  const caches = createRouteCaches(defaultCacheDir())
  const routes = makeRoutes(caches)
  const disposers = routes.map((route) => ctx.webServer.register(route))
  const disposeRoutes = (): void => {
    for (const dispose of disposers.splice(0)) dispose()
  }
  ctx.effect(() => disposeRoutes, 'dsh-news: routes')

  // Periodic disk-cache sweep (startup + hourly).
  const sweep = (): void => {
    for (const disk of [caches.feedDisk, caches.articleDisk, caches.imgDisk]) {
      try {
        disk.sweep()
      } catch {
        // best effort
      }
    }
  }
  sweep()
  const timer = setInterval(sweep, 60 * 60 * 1000)
  timer.unref?.()
  ctx.effect(() => () => { clearInterval(timer) }, 'dsh-news: cache sweep')

  // --- system-prompt announcement section ---
  let current = (): { announceToAgent?: boolean; enabled?: boolean } => config ?? {}
  let disposeSection: (() => void) | undefined
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if ((current().enabled ?? true) === false) return
    if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === false) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-news',
      order: SECTION_ORDER,
      text: NEWS_GUIDANCE,
    })
  }
  installSettingsSection(ctx, NEWS_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })
  sync()
  ctx.effect(() => () => { disposeSection?.() }, 'dsh-news: announce section')
}
