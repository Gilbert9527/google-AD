/**
 * 站点抓取流水线：抓首页 -> 提取内容 -> AdSense 检测 -> 启发式分类 -> 入库
 */
import type { Env } from '../env';
import { num } from '../env';
import { crawlSite } from '../crawler/site';
import { classifyHeuristic } from '../classify/heuristic';

const now = () => Date.now();
const DAY = 24 * 3600_000;
const MAX_FAILS = 3;

function normalizeDomainInput(d: string): string {
  return d.trim().toLowerCase().replace(/^www\./, '');
}

export interface CrawlBatchReport {
  attempted: number;
  ok: number;
  failed: number;
  adsenseHits: number;
}

export async function runCrawlBatch(env: Env, batchSize?: number): Promise<CrawlBatchReport> {
  const db = env.DB;
  const limit = batchSize ?? num(env.BATCH_CRAWL_SITES, 20);
  const report: CrawlBatchReport = { attempted: 0, ok: 0, failed: 0, adsenseHits: 0 };

  // 待抓取：从未抓过的，或 30 天前抓过的（持续刷新）
  const rows = await db
    .prepare(
      `SELECT domain FROM sites
       WHERE status = 'pending'
          OR (status = 'ok' AND (last_crawled IS NULL OR last_crawled < ?))
          OR (status = 'error' AND crawl_fails < ?)
       ORDER BY first_seen ASC
       LIMIT ?`
    )
    .bind(now() - 30 * DAY, MAX_FAILS, limit)
    .all<{ domain: string }>();

  for (const row of rows.results || []) {
    const domain = normalizeDomainInput(row.domain);
    if (!domain || !domain.includes('.')) continue;
    report.attempted++;
    try {
      const res = await crawlSite(domain);
      if (res.error && !res.title) {
        // 抓取失败
        report.failed++;
        await db
          .prepare(
            `UPDATE sites SET status = 'error', crawl_fails = crawl_fails + 1,
             error = ?, last_crawled = ?, http_status = ?, final_url = ?
             WHERE domain = ?`
          )
          .bind(res.error.slice(0, 300), now(), res.httpStatus, res.finalUrl, domain)
          .run();
        continue;
      }
      const finalDomain = res.finalDomain ? normalizeDomainInput(res.finalDomain) : domain;
      const h = classifyHeuristic({
        domain: finalDomain,
        title: res.title,
        description: res.description,
        content: res.contentSample,
      });
      if (res.adsense) report.adsenseHits++;
      report.ok++;
      await db
        .prepare(
          `UPDATE sites SET
             status = 'ok', last_crawled = ?, http_status = ?, final_url = ?,
             adsense = ?, ad_client = ?, title = ?, description = ?, lang = ?,
             content_sample = ?, category = ?, category_source = 'heuristic',
             error = NULL, crawl_fails = 0
           WHERE domain = ?`
        )
        .bind(
          now(), res.httpStatus, res.finalUrl,
          res.adsense ? 1 : 0, res.adClient, res.title, res.description, res.lang,
          res.contentSample, h.category,
          // 重定向到其他域名：记录最终域名（保留旧行，新域名另起一行）
          domain
        )
        .run();
      if (finalDomain && finalDomain !== domain) {
        await db
          .prepare(
            `INSERT INTO sites (domain, source, first_seen, last_seen, status, title, description, category, category_source, adsense)
             VALUES (?, 'redirect', ?, ?, 'ok', ?, ?, ?, 'heuristic', ?)
             ON CONFLICT(domain) DO NOTHING`
          )
          .bind(finalDomain, now(), now(), res.title, res.description, h.category, res.adsense ? 1 : 0)
          .run();
      }
    } catch (e) {
      report.failed++;
      await db
        .prepare(
          `UPDATE sites SET status = 'error', crawl_fails = crawl_fails + 1, error = ?, last_crawled = ? WHERE domain = ?`
        )
        .bind(e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300), now(), domain)
        .run();
    }
  }
  return report;
}
