/**
 * 榜单种子导入：从仓库内的 Majestic Million 前 25 万域名按游标分块导入。
 * 数据文件: data/seeds_top250k.txt（通过 GitHub raw 拉取，模块级缓存）
 * 这些站点作为爬取候选，抓取时自动检测 AdSense（Google 广告投放的站长侧证据），
 * 与广告透明度中心（广告主侧）双轨并行。
 */

const SEED_URL =
  'https://raw.githubusercontent.com/Gilbert9527/google-AD/main/data/seeds_top250k.txt';

let seedsCache: string[] | null = null;

async function loadSeeds(): Promise<string[] | null> {
  if (seedsCache && seedsCache.length) return seedsCache;
  try {
    const res = await fetch(SEED_URL, {
      headers: { 'user-agent': 'google-ad-platform' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // 格式: domain\trank\tref_ips
    seedsCache = text
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => {
        const d = l.split('\t')[0];
        return d && d.includes('.');
      });
    return seedsCache;
  } catch {
    return null;
  }
}

export async function importSeedChunk(env: { DB: D1Database; SEEDS?: KVNamespace }, count: number): Promise<number> {
  let all: string[] | null = null;
  // 优先 KV（若可用），否则走 GitHub raw
  try {
    const listRaw = env.SEEDS ? await env.SEEDS.get('seeds_top250k') : null;
    if (listRaw) all = listRaw.split('\n');
  } catch {
    /* KV 不可用时走 raw */
  }
  if (!all || !all.length) all = await loadSeeds();
  if (!all || !all.length) {
    await debugNote(env.DB, 'seed sources unavailable (KV null, raw fetch failed)');
    return 0;
  }

  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'seed_offset'").first<string>('v');
  let offset = row ? Number(row) : 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (offset >= all.length) {
    // 游标走完：从头部重来（榜单会更新，重新导入无妨，INSERT OR IGNORE 去重）
    offset = 0;
  }

  const chunk = all.slice(offset, offset + count);
  if (!chunk.length) return 0;

  const now = Date.now();
  for (let i = 0; i < chunk.length; i += 80) {
    const part = chunk.slice(i, i + 80);
    await env.DB.batch(
      part.map((line) => {
        const [domain, rankStr, refStr] = line.split('\t');
        const rank = parseInt(rankStr || '0', 10) || null;
        const refIps = parseInt(refStr || '0', 10) || null;
        return env.DB.prepare(
          `INSERT INTO sites (domain, source, first_seen, last_seen, status, majestic_rank, ref_ips)
           VALUES (?, 'seed', ?, ?, 'pending', ?, ?)
           ON CONFLICT(domain) DO UPDATE SET
             majestic_rank = COALESCE(sites.majestic_rank, excluded.majestic_rank),
             ref_ips = COALESCE(sites.ref_ips, excluded.ref_ips)`
        ).bind(domain, now, now, rank, refIps);
      })
    );
  }

  await env.DB.prepare(
    `INSERT INTO kv (k, v) VALUES ('seed_offset', ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`
  )
    .bind(String(offset + chunk.length))
    .run();

  return chunk.length;
}

async function debugNote(db: D1Database, msg: string): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .bind('seed_debug', msg.slice(0, 300))
      .run();
  } catch {
    /* ignore */
  }
}

/** 待抓取队列长度 */
export async function pendingCount(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM sites WHERE status = 'pending'").first<{ c: number }>();
  return r?.c ?? 0;
}
