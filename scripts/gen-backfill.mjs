/** 回填 majestic_rank/ref_ips：用仓库种子文件匹配库内站点，生成并执行 UPDATE SQL */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// 1. 读种子文件（domain\trank\trefips）
const seedMap = new Map();
for (const line of readFileSync('D:/code/google-AD/data/seeds_top250k.txt', 'utf8').split('\n')) {
  const [d, rank, ref] = line.trim().split('\t');
  if (d && d.includes('.')) seedMap.set(d, { rank: parseInt(rank, 10) || null, ref: parseInt(ref, 10) || null });
}
console.log('seed map:', seedMap.size);

// 2. 拉库内全部域名
const out = execSync(
  'npx wrangler d1 execute google-ad --remote -y --json --command "SELECT domain FROM sites"',
  { cwd: 'D:/code/google-AD', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
const rows = JSON.parse(out)[0].results;
console.log('db sites:', rows.length);

// 3. 生成 UPDATE
const stmts = [];
for (const r of rows) {
  const s = seedMap.get(r.domain);
  if (s && (s.rank || s.ref)) {
    stmts.push(`UPDATE sites SET majestic_rank=${s.rank || 'NULL'}, ref_ips=${s.ref || 'NULL'} WHERE domain='${r.domain}' AND majestic_rank IS NULL;`);
  }
}
console.log('updates:', stmts.length);
writeFileSync('D:/code/google-AD/scripts/backfill.sql', stmts.join('\n'));
