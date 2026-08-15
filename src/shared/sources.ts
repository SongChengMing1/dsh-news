/**
 * Built-in content sources (17 feeds across four categories).
 *
 * All URLs were reachability-tested with curl (2025-08-15) and re-verified
 * during milestone M2. Favicons use the conventional `https://<host>/favicon.ico`
 * location; the Client falls back to a letter badge when a favicon 404s.
 */
import type { NewsSource } from './types.ts'

const favicon = (host: string): string => `https://${host}/favicon.ico`

/** The built-in source list, grouped by category. */
export const BUILTIN_SOURCES: readonly NewsSource[] = [
  // 🌍 国际新闻 (5)
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world', language: 'en', favicon: favicon('feeds.bbci.co.uk'), builtin: true },
  { id: 'bbc-chinese', name: 'BBC 中文', url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', category: 'world', language: 'zh', favicon: favicon('feeds.bbci.co.uk'), builtin: true },
  { id: 'guardian-world', name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'world', language: 'en', favicon: favicon('www.theguardian.com'), builtin: true },
  { id: 'nytimes-cn', name: '纽约时报中文网', url: 'https://cn.nytimes.com/rss/', category: 'world', language: 'zh', favicon: favicon('cn.nytimes.com'), builtin: true },
  { id: 'thepaper', name: '澎湃新闻', url: 'https://www.thepaper.cn/rss', category: 'world', language: 'zh', favicon: favicon('www.thepaper.cn'), builtin: true },

  // 🔬 知识科普 (4)
  { id: 'kepuchina', name: '科普中国', url: 'https://www.kepuchina.cn/rss.xml', category: 'science', language: 'zh', favicon: favicon('www.kepuchina.cn'), builtin: true },
  { id: 'sciencedaily', name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/all.xml', category: 'science', language: 'en', favicon: favicon('www.sciencedaily.com'), builtin: true },
  { id: 'livescience', name: 'LiveScience', url: 'https://www.livescience.com/feeds/all', category: 'science', language: 'en', favicon: favicon('www.livescience.com'), builtin: true },
  { id: 'zhihu-daily', name: '知乎日报', url: 'https://www.zhihu.com/rss', category: 'science', language: 'zh', favicon: favicon('www.zhihu.com'), builtin: true },

  // 🏛️ 历史科普 (2)
  { id: 'worldhistory', name: 'World History Encyclopedia', url: 'https://www.worldhistory.org/rss/', category: 'history', language: 'en', favicon: favicon('www.worldhistory.org'), builtin: true },
  { id: 'historyextra', name: 'History Extra (BBC History)', url: 'https://www.historyextra.com/feed/', category: 'history', language: 'en', favicon: favicon('www.historyextra.com'), builtin: true },

  // 🤖 AI 大模型新闻 (6)
  { id: 'jiqizhixin', name: '机器之心', url: 'https://www.jiqizhixin.com/rss', category: 'ai', language: 'zh', favicon: favicon('www.jiqizhixin.com'), builtin: true },
  { id: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed', category: 'ai', language: 'zh', favicon: favicon('www.qbitai.com'), builtin: true },
  { id: 'techcrunch-ai', name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'ai', language: 'en', favicon: favicon('techcrunch.com'), builtin: true },
  { id: 'verge-ai', name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'ai', language: 'en', favicon: favicon('www.theverge.com'), builtin: true },
  { id: 'mit-tr-ai', name: 'MIT Tech Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', category: 'ai', language: 'en', favicon: favicon('www.technologyreview.com'), builtin: true },
  { id: '36kr', name: '36氪', url: 'https://36kr.com/feed', category: 'ai', language: 'zh', favicon: favicon('36kr.com'), builtin: true },
] as const

/** Look up a built-in source by id. */
export function findBuiltinSource(id: string): NewsSource | undefined {
  return BUILTIN_SOURCES.find((s) => s.id === id) as NewsSource | undefined
}
