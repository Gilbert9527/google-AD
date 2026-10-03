/** 用远端库真实创意测 content.js 提取（严格 JSON 解析） */
import { execSync } from 'node:child_process';

const out = execSync(
  'npx wrangler d1 execute google-ad --remote -y --json --command "SELECT raw FROM creatives WHERE raw LIKE \'%displayads-formats%\' LIMIT 5"',
  { cwd: 'D:/code/google-AD', encoding: 'utf8', env: { ...process.env, PATH: 'C:\\Program Files\\nodejs;' + process.env.PATH } }
);
const rows = JSON.parse(out)[0].results;
console.log('rows:', rows.length);

const NON_SITE_HOSTS = [
  'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net',
  'adstransparency.google', 'youtube.com', 'youtu.be', 'play.google.com',
  'apps.apple.com', 'itunes.apple.com', 'blogger.com', 'goo.gl', 'gmail.com',
  'googlemail.com', 'support.google.com', 'policies.google.com',
  'ampproject.org', 'ytimg.com', 'youtube-nocookie.com', 'amp.dev',
  'adservice.google.com', 'w3.org', 'schema.org', 'adform.net', 'adsrvr.org',
];
function extractDomainFromJson(node) {
  const text = typeof node === 'string' ? node : JSON.stringify(node);
  if (!text) return null;
  const urlRe = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})[/"'\\\s)\]]/g;
  let m;
  const seen = new Set();
  while ((m = urlRe.exec(text)) !== null) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (seen.has(host)) continue;
    seen.add(host);
    if (NON_SITE_HOSTS.some((b) => host === b || host.endsWith('.' + b))) continue;
    if (host.length < 4) continue;
    return host;
  }
  return null;
}

for (const row of rows) {
  // row.raw 是数据库里的字符串（JSON 转义过一层）
  let raw;
  try { raw = JSON.parse(row.raw); } catch { raw = row.raw; }
  const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const m = rawStr.match(/https:\/\/displayads-formats\.googleusercontent\.com\/ads\/preview\/content\.js\?[^"'\\\s]+/);
  if (!m) { console.log('no url; raw head:', rawStr.slice(0, 80)); continue; }
  const url = m[0];
  console.log('URL len:', url.length);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://adstransparency.google.com/?hl=en&region=anywhere',
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    console.log(`  HTTP ${res.status} len=${text.length} -> ${extractDomainFromJson(text)}`);
    if (res.status !== 200) console.log('  body head:', text.slice(0, 150));
  } catch (e) {
    console.log('  FETCH ERR', e.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
