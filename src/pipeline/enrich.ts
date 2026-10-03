/**
 * 富化流水线：为已抓取成功的站点补充第三方数据（RDAP/Wayback/Radar/CrUX/PSI）
 */
import type { Env } from '../env';
import { num } from '../env';
import {
  enrichRdap, enrichWayback, enrichRadar, enrichCrux, enrichPsi,
} from '../enrich/providers';
import { computeAdScore } from '../analyze/value';

const now = () => Date.now();

/** 已有广告数据但未评分的站点：补算广告活跃度评分 */
export async function backfillAdScores(db: D1Database, limit = 10): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT domain, ad_count FROM sites
       WHERE ad_count IS NOT NULL AND ad_score IS NULL LIMIT ?`
    )
    .bind(limit)
    .all<{ domain: string; ad_count: number }>();
  let n = 0;
  for (const row of rows.results || []) {
    const agg = await db
      .prepare(
        `SELECT MIN(first_shown) AS f, MAX(last_shown) AS l, COUNT(DISTINCT format) AS fmts
         FROM creatives WHERE domain = ?`
      )
      .bind(row.domain)
      .first<{ f: number | null; l: number | null; fmts: number }>();
    const formats = new Set<number>();
    for (let i = 1; i <= (agg?.fmts || 0); i++) formats.add(i);
    const score = computeAdScore({
      adCount: row.ad_count,
      firstShown: agg?.f ?? null,
      lastShown: agg?.l ?? null,
      formats,
    });
    await db.prepare('UPDATE sites SET ad_score = ? WHERE domain = ?').bind(score, row.domain).run();
    n++;
  }
  return n;
}

export interface EnrichBatchReport { attempted: number; enriched: number; }

export async function runEnrichBatch(env: Env, batchSize?: number): Promise<EnrichBatchReport> {
  const db = env.DB;
  const limit = batchSize ?? num(env.BATCH_ENRICH_SITES, 12);
  const report: EnrichBatchReport = { attempted: 0, enriched: 0 };

  // 顺手补算广告活跃度评分（不占外部请求配额）
  try {
    await backfillAdScores(db, 10);
  } catch {
    /* ignore */
  }

  const rows = await db
    .prepare(
      `SELECT domain FROM sites
       WHERE status = 'ok' AND enrich_status = 'pending'
       ORDER BY first_seen ASC LIMIT ?`
    )
    .bind(limit)
    .all<{ domain: string }>();

  for (const row of rows.results || []) {
    const domain = row.domain;
    report.attempted++;
    try {
      // RDAP + Wayback 每站 2 个请求；Radar/CrUX 有 token 才加
      const [rdap, wayback] = await Promise.all([
        enrichRdap(domain),
        enrichWayback(domain),
      ]);
      let rank: number | null = null;
      if (env.RADAR_TOKEN) {
        const radar = await enrichRadar(domain, env.RADAR_TOKEN);
        if (radar) rank = (JSON.parse(radar) as { rank: number | null }).rank ?? null;
      }
      let crux: string | null = null;
      if (env.GOOGLE_API_KEY) crux = await enrichCrux(domain, env.GOOGLE_API_KEY);

      await db
        .prepare(
          `UPDATE sites SET rdap = ?, wayback = ?, rank = ?, crux = COALESCE(?, crux),
           enrich_status = 'done', enrich_at = ? WHERE domain = ?`
        )
        .bind(rdap, wayback, rank, crux, now(), domain)
        .run();
      report.enriched++;
    } catch {
      await db
        .prepare("UPDATE sites SET enrich_status = 'done', enrich_at = ? WHERE domain = ?")
        .bind(now(), domain)
        .run();
    }
  }
  return report;
}

/** 详情页懒富化：单站点（waitUntil 调用） */
export async function enrichSingleSite(env: Env, domain: string): Promise<void> {
  const db = env.DB;
  try {
    const [rdap, wayback] = await Promise.all([enrichRdap(domain), enrichWayback(domain)]);
    let rank: number | null = null;
    if (env.RADAR_TOKEN) {
      const radar = await enrichRadar(domain, env.RADAR_TOKEN);
      if (radar) rank = (JSON.parse(radar) as { rank: number | null }).rank ?? null;
    }
    let crux: string | null = null;
    if (env.GOOGLE_API_KEY) crux = await enrichCrux(domain, env.GOOGLE_API_KEY);
    await db
      .prepare(
        `UPDATE sites SET rdap = COALESCE(?, rdap), wayback = COALESCE(?, wayback),
         rank = COALESCE(?, rank), crux = COALESCE(?, crux),
         enrich_status = 'done', enrich_at = ? WHERE domain = ?`
      )
      .bind(rdap, wayback, rank, crux, now(), domain)
      .run();
  } catch {
    /* 忽略懒富化错误 */
  }
}
