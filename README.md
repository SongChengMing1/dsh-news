# dsh-news

DSH Web GUI 新闻插件：在左侧栏注入「新闻」入口，点击弹出模态窗，聚合浏览**国际新闻、知识科普、历史科普、AI 大模型新闻**四类内容。

A news plugin for the DSH Web GUI: a sidebar entry opens a modal that aggregates **world news, science, history and AI-model news** from public RSS feeds.

> 状态 / Status：**M1 工程骨架**（开发中）。里程碑见 [任务列表](.plan/任务列表.md)（未入库）。
> M1 skeleton milestone under development. See `.plan/任务列表.md` for the milestone list (not committed).

## 功能 / Features（规划 / Planned）

| 里程碑 | 内容 |
|---|---|
| M1 | 工程骨架：pnpm + tsdown + cordis.patch.yml + CI |
| M2 | Host 端：RSS 抓取/解析、SSRF 防护、缓存、`/news/feed` `/news/article` `/news/img` 三路由 |
| M3 | Client 端：侧边栏入口、弹窗（列表/设置）、i18n（en/zh）、localStorage 配置 |
| M4 | 阅读视图：正文提取、图片代理、站内阅读 |
| M5 | 发布：npm + GitHub release |

## 安装 / Install

### 本地联调 / Local development

```bash
pnpm install
pnpm build
dsh plugin --profile web add link:$PWD
```

安装后刷新 DSH Web GUI，侧边栏出现「新闻 / News」入口。

After installing, refresh the DSH Web GUI — a "新闻 / News" entry appears in the sidebar.

### 发布安装 / Published install（M5 后可用 / available after M5）

```bash
npm i @wilond/dsh-news
dsh plugin --profile web add @wilond/dsh-news
```

## 开发 / Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsdown → lib/
```

## 协议 / License

BSD-3-Clause。详见 [LICENSE](LICENSE)。
