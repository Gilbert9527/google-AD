/**
 * AI 分析流水线：用 Workers AI 生成"网站是做什么的 / 主要功能 / 关键词"
 * 受每日调用限额保护（免费额度），详情页可按需懒分析。
 */
import type { Env } from '../env';
import { num } from '../env';
import { analyzeWithAI } from '../classify/ai';

const now = () => Date.now();

export interface AiBatchReport { attempted: number; analyzed: number; }

export async function runAiBatch(env: Env, batchSize?: number): Promise<AiBatchReport> {
  const db = env.DB;
  const limit = batchSize ?? num(env.BATCH_AI_SITES, 150);
  const dailyLimit = num(env.AI_DAILY_LIMIT, 300);
  const report: AiBatchReport = { attempted: 0, analyzed: 0 };

  const rows = await db
    .prepare(
      `SELECT domain, title, description, lang, adsense, content_sample FROM sites
       WHERE status = 'ok' AND ai_summary IS NULL
       ORDER BY first_seen DESC LIMIT ?`
    )
    .bind(limit)
    .all<{ domain: string; title: string | null; description: string | null; lang: string | null; adsense: number; content_sample: string | null }>();

  for (const row of rows.results || []) {
    report.attempted++;
    const analysis = await analyzeWithAI(
      db,
      env.AI,
      {
        domain: row.domain,
        title: row.title,
        description: row.description,
        lang: row.lang,
        adsense: !!row.adsense,
        content: row.content_sample,
      },
      dailyLimit
    );
    if (!analysis) continue; // 限额或解析失败
    report.analyzed++;
    await db
      .prepare(
        `UPDATE sites SET ai_summary = ?, ai_features = ?, ai_keywords = ?,
         category = COALESCE(NULLIF(?, 'other'), category), category_source = 'ai', ai_at = ?
         WHERE domain = ?`
      )
      .bind(
        analysis.summary,
        JSON.stringify(analysis.features),
        JSON.stringify(analysis.keywords),
        analysis.category,
        now(),
        row.domain
      )
      .run();
  }
  return report;
}

/** 详情页懒分析（waitUntil 调用，单站点） */
export async function analyzeSingleSite(env: Env, domain: string): Promise<void> {
  const db = env.DB;
  const row = await db
    .prepare(
      'SELECT domain, title, description, lang, adsense, content_sample, ai_summary FROM sites WHERE domain = ?'
    )
    .bind(domain)
    .first<{ domain: string; title: string | null; description: string | null; lang: string | null; adsense: number; content_sample: string | null; ai_summary: string | null }>();
  if (!row || row.ai_summary) return;
  const dailyLimit = num(env.AI_DAILY_LIMIT, 300);
  const analysis = await analyzeWithAI(
    db,
    env.AI,
    {
      domain: row.domain,
      title: row.title,
      description: row.description,
      lang: row.lang,
      adsense: !!row.adsense,
      content: row.content_sample,
    },
    dailyLimit
  );
  if (!analysis) return;
  await db
    .prepare(
      `UPDATE sites SET ai_summary = ?, ai_features = ?, ai_keywords = ?,
       category = COALESCE(NULLIF(?, 'other'), category), category_source = 'ai', ai_at = ?
       WHERE domain = ?`
    )
    .bind(
      analysis.summary,
      JSON.stringify(analysis.features),
      JSON.stringify(analysis.keywords),
      analysis.category,
      now(),
      domain
    )
    .run();
}
