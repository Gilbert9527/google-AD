/** 精确对比 online X 与生产参数（25/25）的表现 */
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
  const res = await fetch(`${BASE}/anji/_/rpc/SearchService/SearchSuggestions?authuser=`, {
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
  try { return JSON.parse(text); } catch { return { __raw: text.slice(0, 100) }; }
}

const cookie = await getSession();
const tests = [
  ['online casino 10/10', { 1: 'online casino', 2: 10, 3: 10 }],
  ['online casino 25/25', { 1: 'online casino', 2: 25, 3: 25 }],
  ['online banking 25/25', { 1: 'online banking', 2: 25, 3: 25 }],
  ['online slots 25/25', { 1: 'online slots', 2: 25, 3: 25 }],
  ['best casino 25/25', { 1: 'best casino', 2: 25, 3: 25 }],
];
for (const [name, freq] of tests) {
  const d = await post(cookie, freq);
  const advs = Array.isArray(d?.['1']) ? d['1'].length : 0;
  const doms = Array.isArray(d?.['2']) ? d['2'].length : 0;
  console.log(`${name.padEnd(22)} advertisers=${advs} domains=${doms}`);
  if (doms > 0) console.log('   sample domains:', d['2'].slice(0, 3).map((x) => x?.['2']?.['1']).join(', '));
  await new Promise((r) => setTimeout(r, 600));
}
