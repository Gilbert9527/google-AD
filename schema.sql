-- Google 广告投放网站平台 - D1 数据库结构
-- 本地: npm run db:local   远端: npm run db:remote

CREATE TABLE IF NOT EXISTS sites (
  domain          TEXT PRIMARY KEY,          -- 主域名（无 www）
  source          TEXT DEFAULT 'atc',        -- atc=广告透明度中心 / manual=手工
  first_seen      INTEGER NOT NULL,          -- 首次发现时间
  last_seen       INTEGER,                   -- 最近一次出现在广告源里
  last_crawled    INTEGER,                   -- 最近一次抓取时间
  status          TEXT DEFAULT 'pending',    -- pending|ok|error
  crawl_fails     INTEGER DEFAULT 0,
  http_status     INTEGER,
  final_url       TEXT,                      -- 重定向后的最终 URL
  adsense         INTEGER DEFAULT 0,         -- 是否挂了 AdSense/AdSense 代码
  ad_client       TEXT,                      -- ca-pub-xxxx
  title           TEXT,
  description     TEXT,
  lang            TEXT,
  content_sample  TEXT,                      -- 正文样本（供 AI 分析）
  category        TEXT,                      -- 分类 slug，见 classify/heuristic.ts
  category_source TEXT,                      -- heuristic|ai
  ai_summary      TEXT,                      -- AI：这个网站是做什么的
  ai_features     TEXT,                      -- AI：主要功能 JSON 数组
  ai_keywords     TEXT,                      -- AI：关键词 JSON 数组
  ai_at           INTEGER,
  rank            INTEGER,                   -- Cloudflare Radar 全球排名
  crux            TEXT,                      -- CrUX 真实用户体验 JSON
  rdap            TEXT,                      -- RDAP 注册信息 JSON（域名年龄等）
  wayback         TEXT,                      -- Wayback Machine 历史 JSON
  psi             TEXT,                      -- PageSpeed JSON（可选）
  enrich_status   TEXT DEFAULT 'pending',    -- 第三方数据富化状态
  enrich_at       INTEGER,
  ad_count        INTEGER,                   -- 透明度中心里指向该域名的广告总数
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_category  ON sites(category);
CREATE INDEX IF NOT EXISTS idx_sites_status    ON sites(status, last_crawled);
CREATE INDEX IF NOT EXISTS idx_sites_enrich    ON sites(enrich_status);
CREATE INDEX IF NOT EXISTS idx_sites_adsense   ON sites(adsense);
CREATE INDEX IF NOT EXISTS idx_sites_firstseen ON sites(first_seen DESC);

CREATE TABLE IF NOT EXISTS advertisers (
  advertiser_id TEXT PRIMARY KEY,            -- 透明度中心广告主 ID（AR 开头）
  name          TEXT,
  domain        TEXT,
  region        TEXT,
  done          INTEGER DEFAULT 0,           -- 创意是否已扫描
  found_at      INTEGER
);

CREATE TABLE IF NOT EXISTS creatives (
  creative_id   TEXT NOT NULL,
  advertiser_id TEXT,
  domain        TEXT,
  format        INTEGER,                     -- 1=文本 2=图片 3=视频
  first_shown   INTEGER,
  last_shown    INTEGER,
  raw           TEXT,
  PRIMARY KEY (creative_id, advertiser_id)
);
CREATE INDEX IF NOT EXISTS idx_creatives_domain ON creatives(domain);

CREATE TABLE IF NOT EXISTS keywords (
  keyword         TEXT PRIMARY KEY,
  status          TEXT DEFAULT 'pending',    -- pending|in_progress|done|empty
  pages_done      INTEGER DEFAULT 0,
  next_page_token TEXT,
  sites_found     INTEGER DEFAULT 0,
  last_run        INTEGER
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);
