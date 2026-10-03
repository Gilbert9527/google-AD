# google-AD — Google 广告投放网站采集、分类与分析平台

持续采集 **Google 广告透明度中心**（Ads Transparency Center）中"有广告投放的网站"，自动抓取站点内容、分类（游戏站/博客/电商…）、用 AI 生成"这个网站是做什么的/主要功能/关键词"，并接入第三方数据平台（RDAP / Wayback / CrUX / Cloudflare Radar，付费平台预留）富化网站数据。全栈部署在 **Cloudflare Workers + D1** 上， Cron 触发器实现 7×24 不间断采集。

**线上地址**：部署后形如 `https://google-ad-platform.<你的子域>.workers.dev`

## 架构

```
                    ┌──────────────── Cloudflare ────────────────┐
                    │                                            │
 Cron */10  ──▶ 采集源 Worker ──▶ Google Ads Transparency Center  │
   (发现新网站)      │              (逆向 RPC，免登录)              │
                    ▼                                            │
 Cron */5   ──▶ 抓取 Worker ──▶ 目标网站首页 (内容/AdSense检测)    │
   (站点分析)        │                                           │
                    ▼                                           │
 Cron */30  ──▶ 富化 Worker ──▶ RDAP / Wayback / Radar / CrUX    │
 Cron 0 1   ──▶ AI Worker  ──▶ Workers AI (llama-3.1-8b)         │
                    │                                            │
                    ▼                                            │
                 D1 数据库  ◀── 查询 API + 静态前端 (Hono)         │
                    └────────────────────────────────────────────┘
```

### 采集原理（已实测验证）

Google 未提供官方公开 API，本项目复用透明度中心网页前端使用的内部 RPC（`/anji/_/rpc/...`）：

| RPC | 用途 | 说明 |
|---|---|---|
| `SearchService/SearchSuggestions` | 关键词 → 广告主（名称/AR-ID/地区）+ 域名建议 | 旧版"关键词搜创意"已被 Google 下线，网页端会把关键词转为域名搜索 |
| `SearchService/SearchCreatives`（域名模式） | 域名 → 指向它的广告（数量/创意/广告主） | 验证网站确实有广告在投 |
| `SearchService/SearchCreatives`（广告主模式） | 广告主 → 其全部创意 → 落地域名 | 雪球扩散发现新站 |

三条发现路径组成雪球：**关键词 → 建议域名/广告主 → 广告主创意 → 更多落地域名 → 再验证**。内置 1000+ 种子关键词（可自行追加），目标规模 60,000 站点。

### 数据字段

每个网站存储：域名、标题、描述、语言、**是否挂 AdSense 代码（ca-pub-）**、广告条数、广告主、分类、AI 摘要（做什么的）、AI 主要功能、AI 关键词、Cloudflare Radar 全球排名、域名注册时间/注册商（RDAP）、最早网页快照（Wayback）、真实用户体验指标（CrUX）等。

## 部署

```bash
npm install
npx wrangler login                # 浏览器授权
npx wrangler d1 create google-ad  # 创建数据库，把返回的 database_id 填进 wrangler.jsonc
npm run db:remote                 # 初始化远端表结构
npx wrangler secret put ADMIN_TOKEN   # 管理接口令牌（自定义随机字符串）
npx wrangler deploy               # 部署
```

### 可选密钥（不配置也能跑，数据更丰富）

| Secret | 用途 | 获取方式 |
|---|---|---|
| `GOOGLE_API_KEY` | CrUX 真实用户数据 + PageSpeed | [Google Cloud Console](https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com) 免费创建 API Key |
| `RADAR_TOKEN` | Cloudflare Radar 全球域名排名 | Cloudflare Dashboard → My Profile → API Tokens（免费） |
| `SIMILARWEB_API_KEY` / `SPYFU_API_KEY` / `SEMRUSH_API_KEY` | 付费平台（流量估算/广告情报） | 代码已预留接口，配置即启用 |

```bash
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put RADAR_TOKEN
```

## 使用

- **前端**：`https://<worker域名>/` —— 搜索、分类筛选、统计看板、站点详情（AI 分析 + 第三方数据 + 广告记录）、CSV 导出
- **API**：
  - `GET /api/sites?q=casino&category=game&adsense=1&hasAds=1&sort=recent&page=1&pageSize=20`
  - `GET /api/sites/:domain`（详情，自动触发懒分析/懒富化）
  - `GET /api/stats`、`GET /api/categories`
  - `GET /api/export.csv?q=&category=&limit=20000`
- **管理**（请求头 `x-admin-token: <ADMIN_TOKEN>`）：
  - `POST /api/admin/keywords` `{"keywords":["手游","vpn"]}` —— 追加采集关键词
  - `POST /api/admin/trigger` `{"type":"source|crawl|enrich|ai","size":20}` —— 手动触发一轮
  - `GET /api/admin/status` —— 队列状态

## 速率与规模（免费版 vs 付费版）

| 参数（wrangler.jsonc vars） | 默认(免费) | 建议(Paid $5/月) | 说明 |
|---|---|---|---|
| `BATCH_SOURCE_PAGES` | 20 | 200 | 每 10 分钟发现的域名/广告主数 |
| `BATCH_CRAWL_SITES` | 20 | 300 | 每 5 分钟抓取站点数 |
| `BATCH_ENRICH_SITES` | 12 | 100 | 每 30 分钟富化站点数 |
| `BATCH_AI_SITES` | 150 | 2000 | 每日 AI 深度分析站点数 |
| `AI_DAILY_LIMIT` | 300 | 5000+ | Workers AI 每日调用上限 |

免费版全速运行约 **7-10 天**积累 6 万站点；Workers Paid（$5/月，解除 CPU/subrequest 限制）约 **1-2 天**完成首采。Cron 频率可在 `wrangler.jsonc` 的 `triggers.crons` 调整。

### 实测踩坑记录（2026-10）

- **Google 429 限流**：透明度中心 RPC 对数据中心 IP（含 CF Workers 出口）有严格限流，突发 ~30 请求/小时即触发。已内置：每轮小批量 + 2s 请求间隔 + 429 后全局退避 12 分钟（kv 记录），解封自动恢复。
- **域名建议收窄**：SearchSuggestions 的域名建议（"2" 数组）仅当查询词能匹配真实广告主域名前缀时返回（如 "online casino" → onlinecasino-*），且谷歌会动态调整。主发现引擎因此改为：**关键词→广告主→创意→content.js 预览脚本→落地域名**。
- **落地域名提取**：广告主创意列表响应不含落地域名；HTML/展示广告的 `displayads-formats.googleusercontent.com/ads/preview/content.js` 预览脚本内含真实落地链接（注意 URL 参数含逗号，正则需匹配到引号为止）。
- **Wayback CDX**：archive.org 会拦截部分数据中心 IP，Cloudflare Workers 上可能拿不到（本地/代理环境正常）。RDAP 已改用 Verisign 官方端点（rdap.org 同样拦 DC IP）。
- **D1 本地库**：`wrangler d1 create` 前后 database_id 变化会使本地 `.wrangler/state` 里的旧库失联，重新执行 `npm run db:local` 即可。

### 运行日志（无需登录 dashboard）

每轮 cron 的执行结果写入 D1 的 `kv` 表（保留最近 80 条）：

```bash
npx wrangler d1 execute google-ad --remote -y --command "SELECT v FROM kv WHERE k LIKE 'log_%' ORDER BY k DESC LIMIT 10"
```

## 第三方数据平台选型说明

| 平台 | 数据 | 价格 | 本项目 |
|---|---|---|---|
| RDAP | 域名年龄/注册商 | 免费 | ✅ 默认接入 |
| Wayback CDX | 建站历史 | 免费 | ✅ 默认接入 |
| CrUX API | Google 真实用户性能/流量人口覆盖 | 免费（需 API key） | ✅ 配 key 即启用 |
| Cloudflare Radar | 全球域名排名 | 免费（需 token） | ✅ 配 token 即启用 |
| PageSpeed | Lighthouse 评分 | 免费 | ⚙️ 默认关闭（重） |
| SimilarWeb | 流量估算 | ~$125/月起 | 🔌 预留 |
| SpyFu | Google 广告关键词情报 | ~$29/月起 | 🔌 预留 |
| SEMrush | SEO/流量/广告全套 | ~$140/月起 | 🔌 预留 |

## 本地开发

```bash
npm run dev            # wrangler dev（自动加载 .dev.vars）
npm run db:local       # 本地 D1 建表
curl -X POST http://127.0.0.1:8787/api/admin/trigger -H "x-admin-token: dev-local-token" -d "{\"type\":\"source\"}"
```

> ⚠️ 免责声明：透明度中心 RPC 为逆向接口，Google 可能调整字段（解析层已做容错）。本项目仅抓取公开广告库数据用于市场研究，请遵守当地法律与 Google ToS。
