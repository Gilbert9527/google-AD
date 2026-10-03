/**
 * Google Ads Transparency Center（广告透明度中心）逆向 API 客户端
 * —— 已于 2026-10 通过浏览器抓包 + Node 实测验证
 *
 * 端点: POST https://adstransparency.google.com/anji/_/rpc/{Service}/{Method}?authuser=
 *       Content-Type: application/x-www-form-urlencoded, body: f.req=<JSON>
 *
 * 验证结论（重要）:
 *  - 旧版"关键词创意搜索"已被 Google 下线；网页端会把关键词转为域名搜索
 *  - SearchSuggestions: 关键词 -> 广告主(名称/AR-ID/地区) + 域名建议
 *  - SearchCreatives 域名模式: {"2":count,"3":{"12":{"1":domain,"2":true}},"7":{"1":1,"2":0,"3":2392}}
 *  - SearchCreatives 广告主模式: {"2":count,"3":{"12":{"1":"","2":true},"13":{"1":[ids]}},"7":{"1":1,"2":0,"3":2392}}
 *  - 分页: 响应 ["2"] 为 token，请求顶层 {"4":token}
 *  - 创意条目: ["1"]=广告主ID ["2"]=创意ID ["3"]=创意内容 ["4"]=格式提示
 *              ["6"]["1"]/["7"]["1"]=首次/最近展示(秒级时间戳) ["12"]=广告主名称 ["14"]=域名(域名模式)
 *  - 会话: 主页拿到的 NID cookie 即可，无需登录
 */

const ATC_BASE = 'https://adstransparency.google.com';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 429 退避：被限流后暂停 ATC 请求的时长（毫秒） */
const BACKOFF_MS = 12 * 60_000;
const BACKOFF_KEY = 'atc_backoff_until';

/** 广告过滤的“非落地站”域名 */
const NON_SITE_HOSTS = [
  'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net',
  'adstransparency.google', 'youtube.com', 'youtu.be', 'play.google.com',
  'apps.apple.com', 'itunes.apple.com', 'blogger.com', 'goo.gl', 'gmail.com',
  'googlemail.com', 'support.google.com', 'policies.google.com',
  'ampproject.org', 'ytimg.com', 'youtube-nocookie.com', 'amp.dev',
  'adservice.google.com', 'w3.org', 'schema.org', 'adform.net', 'adsrvr.org',
];

/**
 * 从创意的 content.js 预览脚本中提取落地域名。
 * 创意内容里的 displayads-formats.googleusercontent.com/ads/preview/content.js
 * 返回广告的 HTML 源码，其中包含真实落地页链接。
 */
export async function fetchContentJsDomain(
  contentJsUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(contentJsUrl, {
      headers: {
        'user-agent': BROWSER_UA,
        'referer': `${ATC_BASE}/?hl=en&region=anywhere`,
        'accept': '*/*',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return extractDomainFromJson(text);
  } catch {
    return null;
  }
}

/**
 * 从创意内容片段中提取 content.js 预览脚本 URL。
 * 注意：URL 参数里含逗号（uiFeatures=12,54）等，需匹配到引号/反斜杠/空白为止。
 */
export function extractContentJsUrl(contentSnippet: string | null): string | null {
  if (!contentSnippet) return null;
  const m = contentSnippet.match(
    /https:\/\/displayads-formats\.googleusercontent\.com\/ads\/preview\/content\.js\?[^"'\\\s]+/
  );
  return m ? m[0] : null;
}

/**
 * 过滤“空广告”：assets 载荷过小的创意没有真实内容，
 * content.js 会渲染通用广告壳（默认演示广告），提取出来的是假域名。
 * 真实广告的 assets（gzip base64）通常 > 100 字符。
 */
export function hasSubstantiveAssets(contentJsUrl: string): boolean {
  const m = contentJsUrl.match(/assets=([^&]+)/);
  if (!m) return false;
  return m[1].length >= 60;
}

export function normalizeDomainInput(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  d = d.replace(/^www\./, '');
  return d.replace(/\.$/, '');
}

/** 从任意 JSON 里提取第一个可信的落地页域名 */
export function extractDomainFromJson(node: unknown): string | null {
  const text = typeof node === 'string' ? node : safeStringify(node);
  if (!text) return null;
  const urlRe = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})[/"'\\\s)\]]/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = urlRe.exec(text)) !== null) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (seen.has(host)) continue;
    seen.add(host);
    if (NON_SITE_HOSTS.some((b) => host === b || host.endsWith('.' + b))) continue;
    if (host.length < 4 || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
    return host;
  }
  return null;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) || '';
  } catch {
    return '';
  }
}

/** 容错提取响应里的 JSON 对象 */
function extractJson(text: string): Record<string, unknown> | null {
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  for (const line of text.split('\n')) {
    const i1 = line.indexOf('{');
    const i2 = line.indexOf('[');
    const i = i1 === -1 ? i2 : i2 === -1 ? i1 : Math.min(i1, i2);
    if (i === -1) continue;
    try {
      const parsed = JSON.parse(line.slice(i).trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* next line */
    }
  }
  return null;
}

// ---------- 会话 Cookie ----------

async function kvGet(db: D1Database, k: string): Promise<string | null> {
  return db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first<string>('v');
}

async function kvSet(db: D1Database, k: string, v: string): Promise<void> {
  await db
    .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(k, v)
    .run();
}

/** 获取（并缓存 6 小时）透明度中心会话 Cookie */
export async function getCookieSession(db: D1Database, force = false): Promise<string> {
  if (!force) {
    const cached = await kvGet(db, 'atc_cookies');
    const ts = await kvGet(db, 'atc_cookies_ts');
    if (cached && ts && Date.now() - Number(ts) < 6 * 3600_000) return cached;
  }
  const res = await fetch(`${ATC_BASE}/?hl=en&region=anywhere`, {
    headers: {
      'user-agent': BROWSER_UA,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const parts: string[] = [];
  const cookies = res.headers.getAll('set-cookie');
  for (const c of cookies) parts.push(c.split(';')[0]);
  const cookieStr = parts.join('; ');
  await kvSet(db, 'atc_cookies', cookieStr);
  await kvSet(db, 'atc_cookies_ts', String(Date.now()));
  await kvSet(db, 'atc_home_status', `${res.status} cookies=${parts.length}`);
  return cookieStr;
}

// ---------- RPC 调用 ----------

async function atcPost(db: D1Database, path: string, freq: unknown): Promise<Record<string, unknown> | null> {
  // 退避期内直接快速失败，不消耗请求配额
  const until = Number((await kvGet(db, BACKOFF_KEY)) || 0);
  if (until > Date.now()) {
    throw new Error(`ATC backoff until ${new Date(until).toISOString()}`);
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookie = await getCookieSession(db, attempt > 0);
      const body = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
      const res = await fetch(`${ATC_BASE}${path}?authuser=`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': BROWSER_UA,
          'cookie': cookie,
          'origin': ATC_BASE,
          'referer': `${ATC_BASE}/?hl=en&region=anywhere`,
          'accept-language': 'en-US,en;q=0.9',
        },
        body,
      });
      if (res.status === 429) {
        // 被限流：记录退避时间，立即停止本轮
        await kvSet(db, BACKOFF_KEY, String(Date.now() + BACKOFF_MS)).catch(() => {});
        throw new Error(`ATC ${path} -> HTTP 429 (backoff ${BACKOFF_MS / 60000}min)`);
      }
      if (!res.ok) {
        lastErr = new Error(`ATC ${path} -> HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      // 保留最近一次响应样本，便于远程诊断
      await kvSet(db, 'atc_debug', `${path} ${res.status} len=${text.length} :: ${text.slice(0, 300)}`).catch(() => {});
      const parsed = extractJson(text);
      if (parsed) return parsed;
      // "{}" 是合法的空结果
      if (text.trim() === '{}') return {};
      lastErr = new Error(`ATC ${path} -> unparsable (${res.status}, ${text.length}B): ${text.slice(0, 120)}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes('429')) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const CREATIVE_PATH = '/anji/_/rpc/SearchService/SearchCreatives';
const SUGGESTION_PATH = '/anji/_/rpc/SearchService/SearchSuggestions';

// ---------- 广告主建议 ----------

export interface Suggestion {
  advertiserId: string;
  name: string;
  region: string | null;
}

export interface SuggestResult {
  advertisers: Suggestion[];
  domains: string[];
}

/** 关键词 -> 广告主建议 + 域名建议 */
export async function searchSuggestions(db: D1Database, keyword: string): Promise<SuggestResult> {
  const out: SuggestResult = { advertisers: [], domains: [] };
  // 注意：不要带 "5":{"1":1}（会过滤掉域名建议）；
  // "2"/"3" 是两组建议数量，短核心词可命中大量广告主名称
  const data = await atcPost(db, SUGGESTION_PATH, { 1: keyword, 2: 25, 3: 25 });
  if (!data) return out;
  const advArr = data['1'];
  if (Array.isArray(advArr)) {
    for (const item of advArr) {
      try {
        const inner = (item as Record<string, unknown>)?.['1'] as Record<string, unknown> | undefined;
        if (!inner) continue;
        const id = inner['2'];
        if (typeof id !== 'string' || !/^AR\d{6,}/.test(id)) continue;
        out.advertisers.push({
          advertiserId: id,
          name: typeof inner['1'] === 'string' ? inner['1'] : '',
          region: typeof inner['3'] === 'string' ? inner['3'] : null,
        });
      } catch {
        /* skip */
      }
    }
  }
  const domArr = data['2'];
  if (Array.isArray(domArr)) {
    for (const item of domArr) {
      try {
        const inner = (item as Record<string, unknown>)?.['2'] as Record<string, unknown> | undefined;
        const d = inner?.['1'];
        if (typeof d === 'string' && d.includes('.')) {
          const norm = normalizeDomainInput(d);
          if (norm && !NON_SITE_HOSTS.some((b) => norm === b || norm.endsWith('.' + b))) {
            out.domains.push(norm);
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

// ---------- 创意（广告）搜索 ----------

export interface Creative {
  advertiserId: string | null;
  advertiserName: string | null;
  creativeId: string;
  domain: string | null;
  formatHint: number | null;
  contentSnippet: string | null;
  firstShown: number | null;
  lastShown: number | null;
}

export interface CreativePage {
  creatives: Creative[];
  nextPageToken: string | null;
  shownCount: string | null;
  totalCount: string | null;
}

function tsFrom(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null;
  const secs = Number((node as Record<string, unknown>)['1']);
  return Number.isFinite(secs) && secs > 1e9 ? secs : null;
}

function parseCreativePage(data: Record<string, unknown> | null): CreativePage {
  const page: CreativePage = {
    creatives: [], nextPageToken: null, shownCount: null, totalCount: null,
  };
  if (!data) return page;
  const arr = data['1'];
  if (Array.isArray(arr)) {
    for (const ad of arr as Record<string, unknown>[]) {
      try {
        const creativeId = ad['2'];
        if (typeof creativeId !== 'string' || !creativeId) continue;
        const contentObj = ad['3'];
        const contentSnippet =
          contentObj && typeof contentObj === 'object'
            ? safeStringify(contentObj).slice(0, 8000)
            : null;
        const domainRaw = typeof ad['14'] === 'string' ? ad['14'] : null;
        const domain =
          (domainRaw && normalizeDomainInput(domainRaw)) ||
          extractDomainFromJson(contentObj) ||
          null;
        page.creatives.push({
          advertiserId: typeof ad['1'] === 'string' ? ad['1'] : null,
          advertiserName: typeof ad['12'] === 'string' ? ad['12'] : null,
          creativeId,
          domain,
          formatHint: typeof ad['4'] === 'number' ? ad['4'] : null,
          contentSnippet,
          firstShown: tsFrom(ad['6']),
          lastShown: tsFrom(ad['7']),
        });
      } catch {
        /* skip */
      }
    }
  }
  if (typeof data['2'] === 'string' && data['2']) page.nextPageToken = data['2'];
  if (typeof data['4'] === 'string') page.shownCount = data['4'];
  if (typeof data['5'] === 'string') page.totalCount = data['5'];
  return page;
}

/** 域名 -> 指向该域名的广告 */
export async function searchCreativesByDomain(
  db: D1Database,
  domain: string,
  count = 20,
  pageToken?: string
): Promise<CreativePage> {
  const freq: Record<string, unknown> = {
    2: count,
    3: { 12: { 1: normalizeDomainInput(domain), 2: true } },
    7: { 1: 1, 2: 0, 3: 2392 },
  };
  if (pageToken) freq['4'] = pageToken;
  return parseCreativePage(await atcPost(db, CREATIVE_PATH, freq));
}

/** 广告主 ID -> 该广告主的广告 */
export async function searchCreativesByAdvertiser(
  db: D1Database,
  advertiserId: string,
  count = 20,
  pageToken?: string
): Promise<CreativePage> {
  const freq: Record<string, unknown> = {
    2: count,
    3: { 12: { 1: '', 2: true }, 13: { 1: [advertiserId] } },
    7: { 1: 1, 2: 0, 3: 2392 },
  };
  if (pageToken) freq['4'] = pageToken;
  return parseCreativePage(await atcPost(db, CREATIVE_PATH, freq));
}

/**
 * 创意详情（LookupService/GetCreativeById）——
 * 广告主模式的列表响应不直接给落地域名时，用详情兜底提取。
 */
export async function getCreativeLandingDomain(
  db: D1Database,
  advertiserId: string,
  creativeId: string
): Promise<string | null> {
  try {
    const data = await atcPost(db, '/anji/_/rpc/LookupService/GetCreativeById', {
      1: advertiserId,
      2: creativeId,
      5: { 1: 1 },
    });
    if (!data) return null;
    return extractDomainFromJson(data);
  } catch {
    return null;
  }
}

/** 透明度中心前台链接 */
export function transparencyUrl(domain: string): string {
  return `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(domain)}`;
}
