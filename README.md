# dsh-news

**中文** · [English](README.en.md)

> ⏳ **还在盯着进度条发呆？**
>
> DSH 里的长任务——抓取、训练、批量处理——动辄几分钟甚至更久。与其干等，不如把等待变成阅读时间：
>
> 点开侧边栏「新闻」，**国际要闻 · AI 大模型动态 · 知识科普 · 历史冷知识**一站聚合；正文**站内阅读**不跳外站，标题 / 全文**中英一键互译**，支持**自定义 RSS 源**——全程不离开 GUI、不打断工作流。
>
> 任务结束，世界也刷完了。🌍

DSH Web GUI 新闻插件：在左侧栏注入「新闻」入口，点击弹出模态窗，聚合浏览**国际新闻、知识科普、历史科普、AI 大模型新闻**四类内容，全部文章可**站内阅读**（不跳外站）。

A news plugin for the DSH Web GUI: a sidebar entry opens a modal that aggregates **world news, science, history and AI-model news** from public RSS feeds, with in-place reading (no external jumps).

![DSH Web GUI](https://img.shields.io/badge/dsh-web--gui-blue) ![License](https://img.shields.io/badge/license-BSD--3--Clause-green) ![npm](https://img.shields.io/npm/v/@wilond/dsh-news)

### 界面预览 / Preview

![dsh-news 卡片列表界面](img.png)

---

## 目录 / Table of Contents

- [功能 / Features](#功能--features)
- [安装 / Install](#安装--install)
- [使用 / Usage](#使用--usage)
- [添加自定义 RSS 源 / Custom RSS Sources](#添加自定义-rss-源--custom-rss-sources)
- [内置内容源 / Built-in Sources](#内置内容源--built-in-sources)
- [架构 / Architecture](#架构--architecture)
- [开发 / Development](#开发--development)
- [免责声明 / Disclaimer](#免责声明--disclaimer)
- [协议 / License](#协议--license)

## 功能 / Features

| 能力 | 说明 |
|---|---|
| 侧边栏入口 | 左侧栏「新闻 / News」入口，点击弹出模态框（遮罩 / Esc / 关闭按钮） |
| 四类内容 | 国际新闻 · AI 大模型新闻 · 知识科普 · 历史科普（内置 17 个公开源） |
| 列表浏览 | 分类 tab、时间倒序卡片流（来源徽标 / 标题 / 摘要 / 相对时间 / 缩略图） |
| 站内阅读 | Readability 正文提取 + 白名单清洗，正文图片经 Host 代理（防盗链） |
| 中英翻译 | 列表「翻译列表」总开关：随滚动自动翻译视口内卡片（标题+摘要，失败可重试），开启后点进文章阅读页也自动翻译（标题+正文，可手动切回原文）；Google 免费接口（gtx），跟随 GUI 语言自动互译，Host 缓存 24h |
| 默认源管理 | 澎湃新闻、科普中国、知乎日报、机器之心、36氪 因反爬/改版默认关闭（可设置中开启） |
| 自定义源 | 任意公开 RSS / Atom 地址即加即用（见下方示例），站内阅读与翻译同样生效 |
| 设置 | 内置源逐个启停、自定义源增删、刷新间隔、图片代理、仅摘要模式、RSSHub 实例 |
| i18n | 中 / 英双语（跟随 GUI 语言设置，即时切换） |
| 缓存 | Host 端内存 LRU + 磁盘缓存（feed 15min / 正文 24h / 图片 7d） |
| 安全 | SSRF 防护（内网 / 保留 IP / `.local` 拒绝）、并发限流、超时与失败降级 |

## 安装 / Install

### 方式一：npm 安装（推荐 / Recommended）

```bash
npm i @wilond/dsh-news
dsh plugin --profile web add @wilond/dsh-news
```

安装后**重启 dsh web**（`Ctrl+C` 后重新 `dsh web`），刷新浏览器，侧边栏出现「新闻 / News」入口。

### 方式二：本地联调 / From a local checkout

```bash
git clone https://github.com/SongChengMing1/dsh-news.git
cd dsh-news
pnpm install
pnpm build
dsh plugin --profile web add link:$PWD
```

> 本地联调时每次代码变更需重新 `pnpm build`（Host 半）并重启 dsh web（Client 半）。

### 卸载 / Uninstall

```bash
dsh plugin --profile web remove @wilond/dsh-news
```

## 使用 / Usage

1. 点击侧边栏「新闻 / News」入口打开弹窗。
2. 顶栏切换分类（全部 / 国际 / AI / 科普 / 历史）；「↻」手动强制刷新（绕过缓存）。
3. 列表顶部点「翻译列表」开启总开关：随滚动自动翻译视口内的卡片标题+摘要（翻译失败卡片显示「重试」，再点「关闭翻译」恢复原文）；开关开启时点进文章，阅读页也会自动翻译标题+全文（可点「显示原文」切回，开关关闭时需手动点「翻译全文」），底部「原文链接」在新标签页打开原站。
4. 「⚙」进入设置：启停内置源、添加自定义源、调整刷新间隔（分钟）、图片代理、仅摘要模式、RSSHub 实例地址。

设置保存在浏览器 localStorage（键 `dsh.news.config.v1`），多标签页共享。

## 添加自定义 RSS 源 / Custom RSS Sources

内置源之外，**任何公开的 RSS / Atom 地址**都可以加进来。以 **Hacker News** 为例：

1. 打开新闻弹窗，点右上角「⚙」进入**设置**；
2. 在「自定义源」区域填写：

   | 字段 | 填写内容 |
   |---|---|
   | 名称 | `Hacker News` |
   | RSS 地址 | `https://news.ycombinator.com/rss` |
   | 分类 | 下拉选择（如「国际」或「AI」） |

3. 点「**添加源**」，再点「**保存**」，返回列表即可看到新源的内容——站内阅读、翻译对它同样生效。

更多可直接使用的示例源：

| 源 | RSS 地址 | 建议分类 |
|---|---|---|
| 少数派（数字生活指南） | `https://sspai.com/feed` | 科普 |
| 阮一峰的网络日志 | `https://www.ruanyifeng.com/blog/atom.xml` | 科普 |
| Solidot（奇客资讯） | `https://www.solidot.org/index.rss` | 国际 |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | AI |

> 小提示：
>
> - 地址必须以 `http://` 或 `https://` 开头；重复地址会被拒绝。
> - 没有原生 RSS 的站点，可先用自建 RSSHub 生成 feed 地址再填入。
> - 自定义源与全部设置保存在浏览器 localStorage（键 `dsh.news.config.v1`），多标签页共享。

## 内置内容源 / Built-in Sources

> 注：以下源均为公开 RSS/Atom；个别源可能因站方改版、反爬或网络环境暂时不可用，界面会显示单源降级提示，可在设置中禁用，或通过自定义源 / RSSHub 路由替代。

### 🌍 国际新闻 (5)

| 源 | Feed URL | 语言 |
|---|---|---|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | en |
| BBC 中文 | `https://feeds.bbci.co.uk/zhongwen/simp/rss.xml` | zh |
| The Guardian World | `https://www.theguardian.com/world/rss` | en |
| 纽约时报中文网 | `https://cn.nytimes.com/rss/` | zh |
| 澎湃新闻 | `https://www.thepaper.cn/rss` | zh |

### 🔬 知识科普 (4)

| 源 | Feed URL | 语言 |
|---|---|---|
| 科普中国 | `https://www.kepuchina.cn/rss.xml` | zh |
| ScienceDaily | `https://www.sciencedaily.com/rss/all.xml` | en |
| LiveScience | `https://www.livescience.com/feeds/all` | en |
| 知乎日报 | `https://www.zhihu.com/rss` | zh |

### 🏛️ 历史科普 (2)

| 源 | Feed URL | 语言 |
|---|---|---|
| World History Encyclopedia | `https://www.worldhistory.org/rss/` | en |
| History Extra (BBC History) | `https://www.historyextra.com/feed/` | en |

### 🤖 AI 大模型新闻 (6)

| 源 | Feed URL | 语言 |
|---|---|---|
| 机器之心 | `https://www.jiqizhixin.com/rss` | zh |
| 量子位 | `https://www.qbitai.com/feed` | zh |
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | en |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | en |
| MIT Tech Review AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed` | en |
| 36氪 | `https://36kr.com/feed` | zh |

## 架构 / Architecture

```
┌─ Browser (Client) ────────────────────────┐   ┌─ DSH Host 进程 ─────────────────┐
│ 侧边栏入口：DOM 注入 + MutationObserver   │   │ /news/feed    批量抓取+解析       │
│ 弹窗 (React)：列表 / 阅读 / 设置三视图    │──▶│ /news/article 正文提取+清洗       │
│ localStorage：dsh.news.config.v1          │   │ /news/img     图片代理+防盗链     │
│ i18n：en/zh（dsh-client-locale）          │   │ 缓存：内存 LRU + 磁盘             │
└───────────────────────────────────────────┘   │ systemPrompt 段（可关闭）        │
                                                └──────────────────────────────────┘
```

- Host 无业务状态：配置在 Client（localStorage），抓取时随请求提交源列表；缓存键为源 URL，多标签页天然一致。
- Client 一切抓取走 Host 路由（绕过浏览器 CORS 与源站防盗链）。
- Host 路由统一 `/news/*` 前缀；SSRF 防护 + 代理感知（尊重 `HTTPS_PROXY` / `NO_PROXY` 环境变量）。

## 开发 / Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run（68 用例：guard/cache/rss/article/routes/config/feed-state/reading）
pnpm build       # tsdown → lib/（host ESM + client ModuleLoader bundle）
node scripts/smoke-host.mjs     # 真实网络验收（三路由 + SSRF + 缓存）
node scripts/verify-articles.mjs # 主流源实读验证
```

## 免责声明 / Disclaimer

- 列表以「标题 + 摘要 + 来源链接」为主；正文仅作**临时阅读缓存**（24h 过期），不做永久存档、不提供再分发 / 导出。
- 请遵守各内容源的 robots 协议与使用条款；若频繁使用触发源站风控，请在设置中禁用对应源。
- 本插件与任何内容源无隶属关系；内容版权归原作者 / 原站所有。
- 公共 RSSHub 实例（rsshub.app）已被风控，本插件不依赖公共实例；如有需要请配置自建实例。

## 协议 / License

BSD-3-Clause。详见 [LICENSE](LICENSE)。
