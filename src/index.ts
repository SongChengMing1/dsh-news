/**
 * dsh-news Host half.
 *
 * Milestone M1 skeleton: the plugin row mounts with an empty apply. The
 * webserver routes (/news/feed, /news/article, /news/img), the disk/memory
 * caches, the SSRF guard and the system-prompt announcement section arrive
 * in milestone M2 (see .plan/任务列表.md).
 */
import type { Context } from '@deepseek-ai/cordis'

export const inject: string[] = []

/**
 * Host plugin body.
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  // M2: ctx.webServer.register(...) for /news/*, caches, guard, announce section.
  void ctx
}
