/** 本地复现 content.js 域名提取（用远端库里的真实创意 URL） */
import { readFileSync } from 'node:fs';

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
    if (host.length < 4 || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
    return host;
  }
  return null;
}

const lines = readFileSync(process.env.TEMP + '\\creatives.txt', 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  // 从 D1 JSON 输出行里抠出 raw 字符串
  const rawMatch = line.match(/"raw": "(.*)"\}?$/);
  if (!rawMatch) continue;
  let raw;
  try { raw = JSON.parse('"' + rawMatch[1].replace(/^"|"$/g, '') + '"'); } catch { raw = rawMatch[1]; }
  const m = raw.match(/https:\/\/displayads-formats\.googleusercontent\.com\/ads\/preview\/content\.js\?[A-Za-z0-9=&_%.-]+/);
  if (!m) { console.log('no content.js url in raw'); continue; }
  const url = m[0];
  console.log('fetching:', url.slice(0, 100) + '...');
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://adstransparency.google.com/?hl=en&region=anywhere',
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const dom = extractDomainFromJson(text);
    console.log(`  HTTP ${res.status} len=${text.length} -> domain: ${dom}`);
  } catch (e) {
    console.log('  ERROR', e.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
