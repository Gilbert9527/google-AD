/** Node 端验证：temu.com 域名搜索 + 广告主搜索（正向对照） */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getSession() {
  const res = await fetch(`${BASE}/?hl=en&region=anywhere`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  const cookies = [];
  for (const [k, v] of res.headers.entries()) if (k === 'set-cookie') cookies.push(v.split(';')[0]);
  console.log('session set-cookies:', cookies.length, '→', cookies.map((c) => c.slice(0, 40)).join(' | '));
  return cookies.join('; ');
}

async function post(cookie, path, freq) {
  const body = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
  const res = await fetch(`${BASE}${path}?authuser=`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': UA,
      cookie,
      origin: BASE,
      referer: `${BASE}/?hl=en&region=anywhere`,
      'accept-language': 'en-US,en;q=0.9',
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

function parseAny(text) {
  try { return JSON.parse(text); } catch {}
  for (const line of text.split('\n')) {
    const i1 = line.indexOf('{'), i2 = line.indexOf('[');
    const i = i1 === -1 ? i2 : i2 === -1 ? i1 : Math.min(i1, i2);
    if (i === -1) continue;
    try { return JSON.parse(line.slice(i).trim()); } catch {}
  }
  return null;
}

const cookie = await getSession();

// 1) temu.com 域名搜索
const d = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', {
  2: 5, 3: { 12: { 1: 'temu.com', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 },
});
const dd = parseAny(d.text);
console.log('domain temu.com:', d.status, 'ads=', dd && Array.isArray(dd['1']) ? dd['1'].length : 0, 'len=', d.text.length);

// 2) 广告主搜索
const a = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', {
  2: 5, 3: { 12: { 1: '', 2: true }, 13: { 1: ['AR07816964328396947457'] } }, 7: { 1: 1, 2: 0, 3: 2392 },
});
const aa = parseAny(a.text);
console.log('advertiser AR0781...:', a.status, 'ads=', aa && Array.isArray(aa['1']) ? aa['1'].length : 0, 'len=', a.text.length);

// 3) suggestions 关键词
const s = await post(cookie, '/anji/_/rpc/SearchService/SearchSuggestions', { 1: 'temu', 2: 10, 3: 10, 5: { 1: 1 } });
const ss = parseAny(s.text);
console.log('suggestions temu:', s.status, 'len=', s.text.length, 'has1=', !!(ss && ss['1']), 'has2=', !!(ss && ss['2']));
