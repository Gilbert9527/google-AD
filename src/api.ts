/**
 * 查询 API：站点检索 / 详情 / 统计 / 导出 / 管理触发
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { num } from './env';
import { CATEGORY_LABELS, CATEGORIES } from './classify/heuristic';
import { transparencyUrl } from './sources/atc';
import { runSourceBatch } from './pipeline/source';
import { runCrawlBatch } from './pipeline/crawl';
import { runEnrichBatch, enrichSingleSite } from './pipeline/enrich';
import { runAiBatch, analyzeSingleSite } from './pipeline/ai';

const api = new Hono<{ Bindings: Env }>();

function requireAdmin(env: Env, c: { req: { header: (k: string) => string | undefined } }): Response | null {
  if (!env.ADMIN_TOKEN) return null; // 未设置 token 时拒绝管理操作
  const token = c.req.header('x-admin-token');
  if (token !== env.ADMIN_TOKEN) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return null;
}

// ---------- 站点列表 ----------

api.get('/sites', async (c) => {
  const db = c.env.DB;
  const q = (c.req.query('q') || '').trim().slice(0, 100);
  const category = (c.req.query('category') || '').trim();
  const adsense = c.req.query('adsense');
  const hasAds = c.req.query('hasAds');
  const sort = c.req.query('sort') || 'recent';
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(c.req.query('pageSize')) || 20));

  const where: string[] = ["status = 'ok'"];
  const params: (string | number)[] = [];
  if (q) {
    where.push('(domain LIKE ? OR title LIKE ? OR ai_summary LIKE ? OR description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category && CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    where.push('category = ?');
    params.push(category);
  }
  if (adsense === '1' || adsense === 'true') where.push('adsense = 1');
  if (hasAds === '1' || hasAds === 'true') where.push('ad_count > 0');

  const orderSql =
    sort === 'rank'
      ? 'rank IS NULL, rank ASC'
      : sort === 'name'
        ? 'domain ASC'
        : sort === 'oldest'
          ? 'first_seen ASC'
          : 'first_seen DESC';

  const whereSql = where.join(' AND ');
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM sites WHERE ${whereSql}`)
    .bind(...params)
    .first<{ c: number }>();
  const rows = await db
    .prepare(
      `SELECT domain, title, description, category, category_source, ai_summary, adsense,
              ad_count, rank, lang, first_seen, last_crawled
       FROM sites
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .bind(...params, pageSize, (page - 1) * pageSize)
    .all();

  return Response.json({
    total: totalRow?.c ?? 0,
    page,
    pageSize,
    items: (rows.results || []).map((r: Record<string, unknown>) => ({
      domain: r.domain,
      title: r.title,
      description: r.description,
      category: r.category,
      categoryLabel: r.category ? CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] || r.category : null,
      summary: r.ai_summary,
      adsense: !!r.adsense,
      adCount: r.ad_count,
      rank: r.rank,
      lang: r.lang,
      firstSeen: r.first_seen,
      lastCrawled: r.last_crawled,
    })),
  });
});

// ---------- 站点详情 ----------

api.get('/sites/:domain', async (c) => {
  const db = c.env.DB;
  const domain = c.req.param('domain').toLowerCase().replace(/^www\./, '');
  const site = await db.prepare('SELECT * FROM sites WHERE domain = ?').bind(domain).first<Record<string, unknown>>();
  if (!site) return Response.json({ error: 'not found' }, { status: 404 });

  const creatives = await db
    .prepare(
      `SELECT c.creative_id, c.advertiser_id, c.format, c.first_shown, c.last_shown, c.raw,
              a.name AS advertiser_name
       FROM creatives c LEFT JOIN advertisers a ON a.advertiser_id = c.advertiser_id
       WHERE c.domain = ?
       ORDER BY c.last_shown DESC NULLS LAST LIMIT 12`
    )
    .bind(domain)
    .all();

  const aiFeatures = safeParseArr(site.ai_features as string | null);
  const aiKeywords = safeParseArr(site.ai_keywords as string | null);
  const rdap = safeParseObj(site.rdap as string | null);
  const wayback = safeParseObj(site.wayback as string | null);
  const crux = safeParseObj(site.crux as string | null);

  // 懒分析/懒富化（异步，不阻塞响应）
  const needsAi = site.status === 'ok' && !site.ai_summary;
  const needsEnrich = site.status === 'ok' && site.enrich_status === 'pending';
  if (needsAi || needsEnrich) {
    c.executionCtx.waitUntil(
      (async () => {
        if (needsAi) await analyzeSingleSite(c.env, domain);
        if (needsEnrich) await enrichSingleSite(c.env, domain);
      })()
    );
  }

  return Response.json({
    domain,
    transparencyUrl: transparencyUrl(domain),
    status: site.status,
    httpStatus: site.http_status,
    finalUrl: site.final_url,
    title: site.title,
    description: site.description,
    lang: site.lang,
    adsense: !!site.adsense,
    adClient: site.ad_client,
    adCount: site.ad_count,
    category: site.category,
    categoryLabel: site.category ? CATEGORY_LABELS[site.category as keyof typeof CATEGORY_LABELS] || site.category : null,
    categorySource: site.category_source,
    ai: {
      summary: site.ai_summary,
      features: aiFeatures,
      keywords: aiKeywords,
      analyzedAt: site.ai_at,
    },
    data: {
      rank: site.rank,
      rdap,
      wayback,
      crux,
    },
    firstSeen: site.first_seen,
    lastCrawled: site.last_crawled,
    creatives: (creatives.results || []).map((r: Record<string, unknown>) => ({
      creativeId: r.creative_id,
      advertiserId: r.advertiser_id,
      advertiserName: r.advertiser_name,
      format: r.format,
      firstShown: r.first_shown,
      lastShown: r.last_shown,
    })),
  });
});

function safeParseArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function safeParseObj(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- 分类列表 ----------

api.get('/categories', async (c) => {
  const db = c.env.DB;
  const rows = await db
    .prepare("SELECT category, COUNT(*) AS c FROM sites WHERE status = 'ok' AND category IS NOT NULL GROUP BY category")
    .all<{ category: string; c: number }>();
  const counts = new Map((rows.results || []).map((r) => [r.category, r.c]));
  return Response.json(
    CATEGORIES.map((cat) => ({ category: cat, label: CATEGORY_LABELS[cat], count: counts.get(cat) || 0 }))
  );
});

// ---------- 统计 ----------

api.get('/stats', async (c) => {
  const db = c.env.DB;
  const target = num(c.env.TARGET_SITES, 60000);
  const [totals, crawled, adsense, advCount, kwLeft, enrichLeft, byCategory, lastSeen] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM sites').first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM sites WHERE status = 'ok'").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM sites WHERE adsense = 1").first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM advertisers').first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM keywords WHERE status = 'pending'").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM sites WHERE status = 'ok' AND enrich_status = 'pending'").first<{ c: number }>(),
    db.prepare("SELECT category, COUNT(*) AS c FROM sites WHERE status = 'ok' AND category IS NOT NULL GROUP BY category").all<{ category: string; c: number }>(),
    db.prepare('SELECT MAX(last_crawled) AS t FROM sites').first<{ t: number | null }>(),
  ]);
  const counts = new Map((byCategory.results || []).map((r) => [r.category, r.c]));
  return Response.json({
    target,
    total: totals?.c ?? 0,
    crawled: crawled?.c ?? 0,
    adsense: adsense?.c ?? 0,
    advertisers: advCount?.c ?? 0,
    keywordsLeft: kwLeft?.c ?? 0,
    enrichLeft: enrichLeft?.c ?? 0,
    lastCrawlAt: lastSeen?.t ?? null,
    byCategory: CATEGORIES.map((cat) => ({ category: cat, label: CATEGORY_LABELS[cat], count: counts.get(cat) || 0 })),
  });
});

// ---------- CSV 导出 ----------

api.get('/export.csv', async (c) => {
  const db = c.env.DB;
  const q = (c.req.query('q') || '').trim();
  const category = (c.req.query('category') || '').trim();
  const cap = Math.min(50_000, Number(c.req.query('limit')) || 20_000);
  const where: string[] = ["status = 'ok'"];
  const params: (string | number)[] = [];
  if (q) {
    where.push('(domain LIKE ? OR title LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const rows = await db
    .prepare(
      `SELECT domain, title, category, ai_summary, adsense, ad_count, rank, first_seen
       FROM sites WHERE ${where.join(' AND ')} ORDER BY first_seen DESC LIMIT ?`
    )
    .bind(...params, cap)
    .all<Record<string, unknown>>();
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['domain,title,category,summary,adsense,ad_count,rank,first_seen'];
  for (const r of rows.results || []) {
    lines.push(
      [r.domain, r.title, r.category, r.ai_summary, r.adsense, r.ad_count, r.rank, r.first_seen]
        .map(esc)
        .join(',')
    );
  }
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="google-ad-sites.csv"`,
    },
  });
});

// ---------- 管理接口 ----------

api.post('/admin/keywords', async (c) => {
  const denied = requireAdmin(c.env, c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { keywords?: string[] } | null;
  if (!body?.keywords?.length) return Response.json({ error: 'keywords required' }, { status: 400 });
  const kws = body.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 500);
  await c.env.DB.batch(
    kws.map((k) => c.env.DB.prepare('INSERT OR IGNORE INTO keywords (keyword) VALUES (?)').bind(k))
  );
  return Response.json({ added: kws.length });
});

api.post('/admin/trigger', async (c) => {
  const denied = requireAdmin(c.env, c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { type?: string; size?: number };
  const type = body.type || 'source';
  if (type === 'source') return Response.json(await runSourceBatch(c.env, body.size));
  if (type === 'crawl') return Response.json(await runCrawlBatch(c.env, body.size));
  if (type === 'enrich') return Response.json(await runEnrichBatch(c.env, body.size));
  if (type === 'ai') return Response.json(await runAiBatch(c.env, body.size));
  return Response.json({ error: 'unknown type' }, { status: 400 });
});

api.get('/admin/status', async (c) => {
  const denied = requireAdmin(c.env, c);
  if (denied) return denied;
  const db = c.env.DB;
  const [pending, keywords, advLeft] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS c FROM sites WHERE status = 'pending'").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM keywords WHERE status = 'pending'").first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM advertisers WHERE done = 0').first<{ c: number }>(),
  ]);
  return Response.json({
    queue: { sitesPending: pending?.c ?? 0, keywordsPending: keywords?.c ?? 0, advertisersLeft: advLeft?.c ?? 0 },
  });
});

export { api };
