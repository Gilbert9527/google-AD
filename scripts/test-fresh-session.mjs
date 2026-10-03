/** 全新会话 + 不同UA 测试域名建议是否被降级 */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const r0 = await fetch(`${BASE}/?hl=en&region=anywhere`, { headers: { 'user-agent': UA } });
const c = [];
for (const [k, v] of r0.headers.entries()) if (k === 'set-cookie') c.push(v.split(';')[0]);
console.log('home:', r0.status, 'cookies:', c.length);

const post = async (freq) => {
  const b = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
  const r = await fetch(`${BASE}/anji/_/rpc/SearchService/SearchSuggestions?authuser=`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': UA,
      cookie: c.join('; '),
      origin: BASE,
      referer: `${BASE}/?hl=en&region=anywhere`,
    },
    body: b,
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return null; }
};

for (const kw of ['online casino', 'online slots', 'buy shoes', 'car insurance']) {
  const d = await post({ 1: kw, 2: 10, 3: 10 });
  const advs = Array.isArray(d?.['1']) ? d['1'].length : 0;
  const doms = Array.isArray(d?.['2']) ? d['2'].length : 0;
  console.log(`${kw.padEnd(16)} advertisers=${advs} domains=${doms}`);
  if (doms) console.log('  ', d['2'].slice(0, 4).map((x) => x?.['2']?.['1']).join(', '));
  await new Promise((r) => setTimeout(r, 800));
}
