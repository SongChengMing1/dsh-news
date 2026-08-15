# dsh-news

[中文](README.md) · **English**

> ⏳ **Still staring at the progress bar?**
>
> Long-running DSH tasks — crawling, training, batch processing — can take minutes or more. Instead of waiting idly, turn that waiting time into reading time:
>
> Open "News" in the sidebar and catch up on **world news · AI-model updates · science explainers · history facts** — all in one modal. Articles are readable **right inside the GUI** (no external jumps), with **one-click Chinese ⇄ English translation** of titles and full text, plus support for **custom RSS sources** — all without leaving your workflow.
>
> When your task finishes, you've already caught up with the world. 🌍

A news plugin for the DSH Web GUI: a sidebar entry opens a modal that aggregates **world news, science, history and AI-model news** from public RSS feeds, with in-place reading (no external jumps).

![DSH Web GUI](https://img.shields.io/badge/dsh-web--gui-blue) ![License](https://img.shields.io/badge/license-BSD--3--Clause-green) ![npm](https://img.shields.io/npm/v/@wilond/dsh-news)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Custom RSS Sources](#custom-rss-sources)
- [Built-in Sources](#built-in-sources)
- [Architecture](#architecture)
- [Development](#development)
- [Disclaimer](#disclaimer)
- [License](#license)

## Features

| Capability | Description |
|---|---|
| Sidebar entry | "News" entry in the left sidebar; opens a modal (overlay / Esc / close button) |
| Four categories | World news · AI-model news · science · history (17 built-in public feeds) |
| List browsing | Category tabs, time-descending card stream (source badge / title / summary / relative time / thumbnail) |
| In-place reading | Readability article extraction + whitelist sanitization; article images proxied through the Host (hotlink protection) |
| Bilingual translation | "Translate list" toggle auto-translates cards in view as you scroll (title + summary, retry on failure); with the toggle on, opening an article auto-translates title + full text (switch back to the original anytime); free Google endpoint (gtx), follows the GUI language, 24h Host cache |
| Default-source management | Sources affected by anti-bot / site redesigns (The Paper, Kepuchina, Zhihu Daily, Jiqizhixin, 36Kr) are disabled by default — re-enable them in settings |
| Custom sources | Add any public RSS / Atom feed and read it immediately — in-place reading and translation apply to custom sources too |
| Settings | Enable/disable built-in sources, add/remove custom sources, refresh interval, image proxy, summary-only mode, RSSHub instance |
| i18n | Chinese / English (follows the GUI language, switches instantly) |
| Cache | Host-side in-memory LRU + disk cache (feed 15 min / article 24 h / images 7 d) |
| Security | SSRF protection (internal / reserved IPs / `.local` rejected), concurrency rate limiting, timeouts and graceful degradation |

## Installation

### Option 1: npm (Recommended)

```bash
npm i @wilond/dsh-news
dsh plugin --profile web add @wilond/dsh-news
```

**Restart dsh web** after installing (`Ctrl+C`, then `dsh web` again) and refresh the browser — the "News" entry appears in the sidebar.

### Option 2: From a local checkout

```bash
git clone https://github.com/SongChengMing1/dsh-news.git
cd dsh-news
pnpm install
pnpm build
dsh plugin --profile web add link:$PWD
```

> When developing locally, every code change requires a re-run of `pnpm build` (Host half) and a dsh web restart (Client half).

### Uninstall

```bash
dsh plugin --profile web remove @wilond/dsh-news
```

## Usage

1. Click the "News" entry in the sidebar to open the modal.
2. Switch categories in the top bar (All / World / AI / Science / History); use "↻" to force-refresh (bypasses the cache).
3. Toggle "Translate list" at the top of the list: cards in view are auto-translated as you scroll (title + summary; failed cards show "Retry"; toggle off to restore the original). With the toggle on, opening an article also auto-translates its title + full text (use "Show original" to switch back; when the toggle is off, click "Translate" manually). The "Open original" link at the bottom opens the source site in a new tab.
4. Click "⚙" for settings: enable/disable built-in sources, add custom sources, adjust the refresh interval (minutes), image proxy, summary-only mode, and RSSHub instance.

Settings are stored in browser localStorage (key `dsh.news.config.v1`) and shared across tabs.

## Custom RSS Sources

Beyond the built-in feeds, **any public RSS / Atom URL** can be added. Here's an example with **Hacker News**:

1. Open the news modal and click "⚙" in the top-right corner to enter **Settings**.
2. In the **Custom sources** section, fill in:

   | Field | Value |
   |---|---|
   | Name | `Hacker News` |
   | RSS URL | `https://news.ycombinator.com/rss` |
   | Category | Choose from the dropdown (e.g. "World" or "AI") |

3. Click "**Add source**", then "**Save**" — back in the list you'll see the new source's content. In-place reading and translation work on it just the same.

More ready-to-use example feeds:

| Source | RSS URL | Suggested category |
|---|---|---|
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | AI |
| The Verge | `https://www.theverge.com/rss/index.xml` | World |
| NASA Breaking News | `https://www.nasa.gov/rss/dyn/breaking_news.rss` | Science |
| Smithsonian Magazine | `https://www.smithsonianmag.com/rss/latest_articles/` | History |

> Tips:
>
> - The URL must start with `http://` or `https://`; duplicate URLs are rejected.
> - For sites without a native RSS feed, generate one with a self-hosted RSSHub instance and add that feed URL.
> - Custom sources and all settings live in browser localStorage (key `dsh.news.config.v1`), shared across tabs.

## Built-in Sources

> Note: all sources below are public RSS/Atom feeds; individual feeds may be temporarily unavailable due to site redesigns, anti-bot measures or network conditions — the UI shows a per-source degradation notice. Disable them in settings, or replace them via custom sources / RSSHub routes.

### 🌍 World News (5)

| Source | Feed URL | Lang |
|---|---|---|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | en |
| BBC Chinese | `https://feeds.bbci.co.uk/zhongwen/simp/rss.xml` | zh |
| The Guardian World | `https://www.theguardian.com/world/rss` | en |
| NYT Chinese | `https://cn.nytimes.com/rss/` | zh |
| The Paper (澎湃新闻) | `https://www.thepaper.cn/rss` | zh |

### 🔬 Science (4)

| Source | Feed URL | Lang |
|---|---|---|
| Kepuchina (科普中国) | `https://www.kepuchina.cn/rss.xml` | zh |
| ScienceDaily | `https://www.sciencedaily.com/rss/all.xml` | en |
| LiveScience | `https://www.livescience.com/feeds/all` | en |
| Zhihu Daily (知乎日报) | `https://www.zhihu.com/rss` | zh |

### 🏛️ History (2)

| Source | Feed URL | Lang |
|---|---|---|
| World History Encyclopedia | `https://www.worldhistory.org/rss/` | en |
| History Extra (BBC History) | `https://www.historyextra.com/feed/` | en |

### 🤖 AI-Model News (6)

| Source | Feed URL | Lang |
|---|---|---|
| Jiqizhixin (机器之心) | `https://www.jiqizhixin.com/rss` | zh |
| QbitAI (量子位) | `https://www.qbitai.com/feed` | zh |
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | en |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | en |
| MIT Tech Review AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed` | en |
| 36Kr (36氪) | `https://36kr.com/feed` | zh |

## Architecture

```
┌─ Browser (Client) ───────────────────────┐   ┌─ DSH Host process ──────────────────┐
│ Sidebar entry: DOM injection + observer  │   │ /news/feed    batch fetch + parse   │
│ Modal (React): list / reading / settings │──▶│ /news/article extract + sanitize    │
│ localStorage: dsh.news.config.v1         │   │ /news/img     image proxy (hotlink) │
│ i18n: en/zh (dsh-client-locale)          │   │ Cache: memory LRU + disk            │
└──────────────────────────────────────────┘   │ systemPrompt section (toggleable)   │
                                                  └─────────────────────────────────────┘
```

- The Host keeps no business state: configuration lives in the Client (localStorage) and the source list is submitted with each fetch request; cache keys are source URLs, so multiple tabs stay consistent naturally.
- All Client fetching goes through Host routes (bypassing browser CORS and source-site hotlink protection).
- Host routes share the `/news/*` prefix; SSRF protection + proxy awareness (respects `HTTPS_PROXY` / `NO_PROXY` environment variables).

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run (68 tests: guard/cache/rss/article/routes/config/feed-state/reading)
pnpm build       # tsdown → lib/ (host ESM + client ModuleLoader bundle)
node scripts/smoke-host.mjs      # real-network acceptance (3 routes + SSRF + cache)
node scripts/verify-articles.mjs # read-through verification on major sources
```

## Disclaimer

- Lists are mainly "title + summary + source link"; article bodies are only a **temporary reading cache** (24h expiry) — no permanent archiving, no redistribution / export.
- Please respect each source's robots protocol and terms of use; if heavy usage triggers source-side risk control, disable the corresponding source in settings.
- This plugin is not affiliated with any content source; all content copyright belongs to the original authors / sites.
- The public RSSHub instance (rsshub.app) is rate-limited; this plugin does not depend on public instances — configure a self-hosted instance if needed.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
