/** 验证分页 token 传递位置 */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getSession() {
  const res = await fetch(`${BASE}/?hl=en&region=anywhere`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  const cookies = [];
  for (const [k, v] of res.headers.entries()) if (k === 'set-cookie') cookies.push(v.split(';')[0]);
  return cookies.join('; ');
}

async function post(cookie, freq) {
  const body = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
  const res = await fetch(`${BASE}/anji/_/rpc/SearchService/SearchCreatives?authuser=`, {
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
  return res.text();
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
const base = { 2: 5, 3: { 12: { 1: 'temu.com', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 } };

const p1 = parseAny(await post(cookie, base));
const ids1 = p1['1'].map((a) => a['2']);
const token = p1['2'];
console.log('page1 ids:', ids1.join(','));
console.log('token:', token);

// 位置A: 顶层 "4"
const t2 = parseAny(await post(cookie, { ...base, 4: token }));
console.log('page2 top-level "4":', t2 && Array.isArray(t2['1']) ? t2['1'].map(a => a['2']).join(',') : JSON.stringify(t2).slice(0, 100));

// 位置B: "1":{"4":token}
const t3 = parseAny(await post(cookie, { ...base, 1: { 4: token } }));
console.log('page2 inside "1".4:', t3 && Array.isArray(t3['1']) ? t3['1'].map(a => a['2']).join(',') : JSON.stringify(t3).slice(0, 100));
