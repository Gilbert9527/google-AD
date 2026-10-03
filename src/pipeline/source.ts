/**
 * 采集源流水线：从广告透明度中心持续发现"有 Google 广告投放的网站"
 *
 * 三种发现路径（形成雪球）：
 *  A. 关键词 -> SearchSuggestions -> 广告主(AR-ID) + 域名建议
 *  B. 广告主 -> SearchCreatives(byAdvertiser) -> 落地域名 + 广告记录
 *  C. 域名   -> SearchCreatives(byDomain)     -> 验证广告数 + 更多广告主ID
 *
 * Google 对边缘 IP 有 429 限流：每轮小批量 + 请求间隔 + 退避（见 atc.ts）
 */
import type { Env } from '../env';
import { num as getNum } from '../env';
import {
  searchSuggestions,
  searchCreativesByDomain,
  searchCreativesByAdvertiser,
  getCreativeLandingDomain,
  normalizeDomainInput,
} from '../sources/atc';
import { buildKeywordSeeds, deriveKeywordsFromDomains } from '../seed/keywords';
import { fetchContentJsDomain, extractContentJsUrl } from '../sources/atc';

/** 每个广告主最多取几个创意的 content.js 预览来提取落地域名（Workers Paid 可调大） */
const CONTENTJS_PER_ADV = 3;

const now = () => Date.now();
/** ATC 请求间隔（毫秒）：温和节奏降低 429 概率 */
const ATC_SPACING_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEED_VERSION = '3'; // 关键词池版本，更新种子列表时递增以触发重新播种

async function seedKeywordsIfEmpty(db: D1Database): Promise<number> {
  const ver = await db
    .prepare('SELECT v FROM kv WHERE k = ?')
    .bind('kw_seed_ver')
    .first<string>('v');
  if (ver === SEED_VERSION) return 0;
  const seeds = buildKeywordSeeds();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < seeds.length; i += 80) {
    const chunk = seeds.slice(i, i + 80);
    const sql =
      'INSERT OR IGNORE INTO keywords (keyword) VALUES ' +
      chunk.map(() => '(?)').join(',');
    stmts.push(db.prepare(sql).bind(...chunk));
  }
  await db.batch(stmts);
  await db
    .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind('kw_seed_ver', SEED_VERSION)
    .run();
  return seeds.length;
}

/** 站点 upsert：新站进抓取队列；老站刷新 last_seen */
function upsertSiteStmt(db: D1Database, domain: string, source: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sites (domain, source, first_seen, last_seen, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON CONFLICT(domain) DO UPDATE SET last_seen = excluded.last_seen`
    )
    .bind(domain, source, now(), now());
}

async function upsertAdvertisers(
  db: D1Database,
  list: { advertiserId: string; name: string; region: string | null; domain: string | null }[]
): Promise<void> {
  if (!list.length) return;
  const stmts = list.map((a) =>
    db
      .prepare(
        `INSERT INTO advertisers (advertiser_id, name, domain, region, found_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(advertiser_id) DO UPDATE SET
           name = CASE WHEN excluded.name != '' THEN excluded.name ELSE advertisers.name END,
           domain = COALESCE(excluded.domain, advertisers.domain),
           region = COALESCE(excluded.region, advertisers.region)`
      )
      .bind(a.advertiserId, a.name || '', a.domain, a.region, now())
  );
  await db.batch(stmts);
}

async function upsertCreatives(
  db: D1Database,
  rows: {
    creativeId: string;
    advertiserId: string | null;
    domain: string | null;
    format: number | null;
    firstShown: number | null;
    lastShown: number | null;
    raw: string | null;
  }[]
): Promise<void> {
  if (!rows.length) return;
  const stmts = rows.map((c) =>
    db
      .prepare(
        `INSERT INTO creatives (creative_id, advertiser_id, domain, format, first_shown, last_shown, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(creative_id, advertiser_id) DO UPDATE SET
           last_shown = COALESCE(excluded.last_shown, creatives.last_shown),
           domain = COALESCE(excluded.domain, creatives.domain)`
      )
      .bind(c.creativeId, c.advertiserId, c.domain, c.format, c.firstShown, c.lastShown, c.raw)
  );
  for (let i = 0; i < stmts.length; i += 40) {
    await db.batch(stmts.slice(i, i + 40));
  }
}

export interface SourceBatchReport {
  keywordsProcessed: number;
  domainsDiscovered: number;
  advertisersDiscovered: number;
  creativesStored: number;
  advertiserPages: number;
  domainVerifies: number;
  keywordsSeeded: number;
  contentJsAttempts: number;
  contentJsHits: number;
  errors: string[];
}

/**
 * 一轮采集（温和配额，总计 5-9 个 ATC 请求，避开 Google 429）：
 *   1. 取 2 个 pending 关键词做 suggestions
 *   2. 取 3 个未处理广告主做创意搜索
 *   3. 取 1 个未验证域名做域名搜索
 */
export async function runSourceBatch(env: Env, _maxPages?: number): Promise<SourceBatchReport> {
  const db = env.DB;
  const report: SourceBatchReport = {
    keywordsProcessed: 0, domainsDiscovered: 0, advertisersDiscovered: 0,
    creativesStored: 0, advertiserPages: 0, domainVerifies: 0,
    keywordsSeeded: 0, contentJsAttempts: 0, contentJsHits: 0, errors: [],
  };
  void _maxPages;

  try {
    report.keywordsSeeded = await seedKeywordsIfEmpty(db);
  } catch (e) {
    report.errors.push('seed: ' + (e instanceof Error ? e.message : String(e)));
  }

  let backoff = false; // 触发 429 后本轮剩余步骤跳过

  // ---- A. 关键词建议 ----
  // "online X" 最优先（实测会返回域名建议，如 onlinecasino-*），
  // 其次其它多词查询，最后单核心词（只出广告主名）
  const kwRows = await db
    .prepare(
      `SELECT keyword FROM keywords WHERE status = 'pending'
       ORDER BY (keyword LIKE 'online %') DESC, (keyword LIKE '% %') DESC, keyword LIMIT 4`
    )
    .all<{ keyword: string }>();
  let kwBudget = 2;
  for (const kw of kwRows.results || []) {
    if (kwBudget <= 0 || backoff) break;
    try {
      const sug = await searchSuggestions(db, kw.keyword);
      // 域名建议入库
      if (sug.domains.length) {
        const stmts = sug.domains.map((d) => upsertSiteStmt(db, d, 'atc_suggest'));
        await db.batch(stmts);
        report.domainsDiscovered += sug.domains.length;
      }
      // 广告主入库
      if (sug.advertisers.length) {
        await upsertAdvertisers(
          db,
          sug.advertisers.map((a) => ({ ...a, domain: null }))
        );
        report.advertisersDiscovered += sug.advertisers.length;
      }
      await db
        .prepare("UPDATE keywords SET status = 'done', last_run = ?, sites_found = ? WHERE keyword = ?")
        .bind(now(), sug.advertisers.length + sug.domains.length, kw.keyword)
        .run();
      report.keywordsProcessed++;
      kwBudget--;
      await sleep(ATC_SPACING_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('backoff') || msg.includes('429')) backoff = true;
      if (report.errors.length < 6) {
        report.errors.push(`kw[${kw.keyword}]: ` + msg);
      }
      await db
        .prepare("UPDATE keywords SET status = 'pending', last_run = ? WHERE keyword = ?")
        .bind(now(), kw.keyword)
        .run();
    }
  }

  // ---- B. 广告主创意（拿落地域名）----
  const advBudget = 3;
  const advRows = await db
    .prepare(
      `SELECT a.advertiser_id, a.domain FROM advertisers a
       LEFT JOIN sites s ON s.domain = a.domain
       WHERE a.done = 0 AND (a.domain IS NULL OR s.domain IS NULL)
       ORDER BY a.found_at DESC LIMIT ?`
    )
    .bind(advBudget)
    .all<{ advertiser_id: string; domain: string | null }>();

  const doneIds: string[] = [];
  for (const adv of advRows.results || []) {
    if (backoff) break;
    try {
      await sleep(ATC_SPACING_MS);
      const page = await searchCreativesByAdvertiser(db, adv.advertiser_id, 20);
      const domains = new Set<string>();
      const rows = page.creatives.map((c) => {
        if (c.domain) domains.add(c.domain);
        return {
          creativeId: c.creativeId,
          advertiserId: c.advertiserId || adv.advertiser_id,
          domain: c.domain,
          format: c.formatHint,
          firstShown: c.firstShown,
          lastShown: c.lastShown,
          raw: c.contentSnippet,
        };
      });
      // 落地域名提取：优先 content.js 预览脚本（含真实落地页链接），
      // 再用创意详情兜底（每个广告主最多 CONTENTJS_PER_ADV + 1 次额外请求）
      if (domains.size === 0 && page.creatives.length > 0) {
        for (const c of page.creatives) {
          if (domains.size >= 2) break;
          const jsUrl = extractContentJsUrl(c.contentSnippet);
          if (!jsUrl) continue;
          report.contentJsAttempts++;
          const dom = await fetchContentJsDomain(jsUrl);
          if (dom) {
            report.contentJsHits++;
            domains.add(dom);
            const row = rows.find((r) => r.creativeId === c.creativeId);
            if (row) row.domain = dom;
          }
          if (domains.size >= 2) break;
        }
        if (domains.size === 0) {
          const first = page.creatives[0];
          const advId = first.advertiserId || adv.advertiser_id;
          if (advId) {
            const landing = await getCreativeLandingDomain(db, advId, first.creativeId);
            if (landing) {
              domains.add(landing);
              if (rows.length) rows[0].domain = landing;
            }
          }
        }
      }
      await upsertCreatives(db, rows);
      report.creativesStored += rows.length;
      // 落地域名入库
      const newDomains = [...domains].filter((d) => d && d !== adv.domain);
      if (newDomains.length) {
        await db.batch(newDomains.slice(0, 20).map((d) => upsertSiteStmt(db, d, 'atc_adv')));
        report.domainsDiscovered += newDomains.length;
      }
      doneIds.push(adv.advertiser_id);
      report.advertiserPages++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('backoff') || msg.includes('429')) backoff = true;
      if (report.errors.length < 6) {
        report.errors.push('adv: ' + msg);
      }
    }
  }
  if (doneIds.length) {
    await db.batch(
      doneIds.map((id) =>
        db.prepare("UPDATE advertisers SET done = 1 WHERE advertiser_id = ?").bind(id)
      )
    );
  }

  // ---- B2. 存量创意挖掘：从已入库的 HTML 广告 content.js 提取落地域名 ----
  // content.js 走 googleusercontent.com，不占透明度中心 RPC 配额
  try {
    const mined = await db
      .prepare(
        `SELECT creative_id, advertiser_id, raw FROM creatives
         WHERE domain IS NULL AND raw LIKE '%displayads-formats%'
           AND (advertiser_id IS NULL OR advertiser_id NOT IN
                (SELECT DISTINCT advertiser_id FROM creatives WHERE domain IS NOT NULL))
         ORDER BY first_shown DESC LIMIT 3`
      )
      .all<{ creative_id: string; advertiser_id: string | null; raw: string }>();
    for (const row of mined.results || []) {
      const jsUrl = extractContentJsUrl(row.raw);
      if (!jsUrl) continue;
      const dom = await fetchContentJsDomain(jsUrl);
      if (!dom) continue;
      report.contentJsAttempts++;
      report.contentJsHits++;
      await db
        .prepare('UPDATE creatives SET domain = ? WHERE creative_id = ? AND advertiser_id IS ?')
        .bind(dom, row.creative_id, row.advertiser_id)
        .run();
      await db.batch([upsertSiteStmt(db, dom, 'atc_creative')]);
      report.domainsDiscovered++;
      await sleep(1200);
    }
  } catch (e) {
    if (report.errors.length < 6) {
      report.errors.push('mine: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ---- C. 域名验证（确认有广告 + 广告主关联 + 广告数）----
  const verBudget = 1;
  const siteRows = await db
    .prepare(
      `SELECT domain FROM sites
       WHERE source LIKE 'atc%' AND ad_count IS NULL AND status = 'pending'
       ORDER BY first_seen ASC LIMIT ?`
    )
    .bind(verBudget)
    .all<{ domain: string }>();

  for (const site of siteRows.results || []) {
    if (backoff) break;
    try {
      await sleep(ATC_SPACING_MS);
      const page = await searchCreativesByDomain(db, site.domain, 20);
      const adTotal = page.totalCount ? Number(page.totalCount) : page.creatives.length;
      const rows = page.creatives.map((c) => ({
        creativeId: c.creativeId,
        advertiserId: c.advertiserId,
        domain: site.domain,
        format: c.formatHint,
        firstShown: c.firstShown,
        lastShown: c.lastShown,
        raw: c.contentSnippet,
      }));
      await upsertCreatives(db, rows);
      report.creativesStored += rows.length;
      // 广告主关联
      const advs = page.creatives
        .filter((c) => c.advertiserId)
        .map((c) => ({
          advertiserId: c.advertiserId as string,
          name: c.advertiserName || '',
          region: null,
          domain: site.domain,
        }));
      if (advs.length) {
        await upsertAdvertisers(db, advs);
        report.advertisersDiscovered += advs.length;
      }
      await db
        .prepare('UPDATE sites SET ad_count = ?, last_seen = ? WHERE domain = ?')
        .bind(adTotal, now(), site.domain)
        .run();
      report.domainVerifies++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('backoff') || msg.includes('429')) backoff = true;
      if (report.errors.length < 6) {
        report.errors.push('verify: ' + msg);
      }
    }
  }

  // ---- D. 域名反哺关键词（雪球）：拿最新发现的域名派生新关键词 ----
  try {
    const recentSites = await db
      .prepare(
        `SELECT domain FROM sites WHERE source LIKE 'atc%' ORDER BY first_seen DESC LIMIT 2`
      )
      .all<{ domain: string }>();
    const derived = deriveKeywordsFromDomains(recentSites.results?.map((r) => r.domain) || []);
    if (derived.length) {
      await db.batch(
        derived.map((k) =>
          db.prepare('INSERT OR IGNORE INTO keywords (keyword) VALUES (?)').bind(k)
        )
      );
      report.domainsDiscovered += 0; // 不重复计数，仅扩充关键词池
    }
  } catch {
    /* 雪球步骤失败不影响主流程 */
  }

  return report;
}
