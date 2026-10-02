/** 批量测试哪些关键词能命中广告主建议 */
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
  try { return JSON.parse(text); } catch { return null; }
}

const cookie = await getSession();
const kws = ['casino', 'slots', 'bet', 'game', 'shop', 'loan', 'insurance', 'hotel',
  'vpn', 'crypto', 'trading', 'fashion', 'pharmacy', 'dating', 'hosting',
  'travel', 'finance', 'software', 'casino online', 'online casino'];

for (const kw of kws) {
  const data = await post(cookie, '/anji/_/rpc/SearchService/SearchSuggestions', { 1: kw, 2: 10, 3: 10, 5: { 1: 1 } });
  const advs = Array.isArray(data?.['1']) ? data['1'].length : 0;
  const doms = Array.isArray(data?.['2']) ? data['2'].length : 0;
  console.log(`${kw.padEnd(16)} advertisers=${advs} domains=${doms}`);
  await new Promise((r) => setTimeout(r, 400));
}
