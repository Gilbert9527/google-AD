/**
 * 入口：Hono API 路由 + Cron 定时调度
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { api } from './api';
import { runSourceBatch } from './pipeline/source';
import { runCrawlBatch } from './pipeline/crawl';
import { runEnrichBatch } from './pipeline/enrich';
import { runAiBatch } from './pipeline/ai';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api);

// 兜底：非 /api 路径交给静态资源
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = controller.cron;
    const log = async (msg: string) => {
      try {
        await env.DB.prepare(
          'INSERT INTO kv (k, v) VALUES (?, ?)'
        )
          .bind(
            'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            `${new Date().toISOString()} [${cron}] ${msg}`.slice(0, 800)
          )
          .run();
        // 只保留最近 80 条日志
        await env.DB.prepare(
          `DELETE FROM kv WHERE k LIKE 'log_%' AND k NOT IN
           (SELECT k FROM kv WHERE k LIKE 'log_%' ORDER BY k DESC LIMIT 80)`
        )
          .run();
      } catch {
        /* ignore */
      }
    };
    try {
      if (cron === '*/10 * * * *') {
        // 采集源：透明度中心发现新网站
        const r = await runSourceBatch(env);
        await log('ok ' + JSON.stringify(r));
      } else if (cron === '*/5 * * * *') {
        // 站点抓取：首页内容 + 分类
        const r = await runCrawlBatch(env);
        await log('ok ' + JSON.stringify(r));
      } else if (cron === '*/30 * * * *') {
        // 第三方数据富化
        const r = await runEnrichBatch(env);
        await log('ok ' + JSON.stringify(r));
      } else if (cron === '0 1 * * *') {
        // 每日 AI 深度分析
        const r = await runAiBatch(env);
        await log('ok ' + JSON.stringify(r));
      }
    } catch (e) {
      console.error('[scheduled error]', cron, e instanceof Error ? e.stack : String(e));
      await log('ERROR ' + (e instanceof Error ? e.stack || e.message : String(e)));
    }
  },
} satisfies ExportedHandler<Env>;
