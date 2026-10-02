/**
 * SearchCreatives 请求字段变体试验
 */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getSession() {
  const res = await fetch(`${BASE}/?hl=en&region=anywhere`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  const cookies = [];
  for (const [k, v] of res.headers.entries()) {
    if (k === 'set-cookie') cookies.push(v.split(';')[0]);
  }
  return cookies.join('; ');
}

async function post(cookie, path, freq) {
  const body = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
  const res = await fetch(`${BASE}${path}?authuser=0`, {
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
  const lines = text.split('\n');
  for (const line of lines) {
    const i1 = line.indexOf('{'), i2 = line.indexOf('[');
    const i = i1 === -1 ? i2 : i2 === -1 ? i1 : Math.min(i1, i2);
    if (i === -1) continue;
    try { return JSON.parse(line.slice(i).trim()); } catch {}
  }
  return null;
}

const cookie = await getSession();
const kw = process.argv[2] || 'online casino';
const advId = process.argv[3] || 'AR12898764994459467777';

const variants = [
  ['kw exact v1', { 2: 10, 3: { 12: { 1: kw, 2: true } }, 7: { 1: 1 } }],
  ['kw plain', { 2: 10, 3: { 12: { 1: kw } } }],
  ['kw v2 with 6', { 2: 10, 3: { 12: { 1: kw, 2: true } }, 6: { 1: 1 } }],
  ['kw v3 with 8', { 2: 10, 3: { 12: { 1: kw, 2: true } }, 8: { 1: 'anywhere' } }],
  ['kw v4 with 9', { 2: 10, 3: { 12: { 1: kw, 2: true } }, 9: { 1: 'anywhere' } }],
  ['kw v5 count40', { 2: 40, 3: { 12: { 1: kw, 2: true } }, 7: { 1: 1 } }],
  ['domain plain', { 2: 10, 3: { 12: { 1: 'onlinecasino-ro.com' } } }],
  ['advertiser v1', { 2: 10, 3: { 12: { 1: '', 2: true }, 13: { 1: [advId] } }, 7: { 1: 1 } }],
  ['advertiser v2', { 2: 10, 3: { 13: { 1: [advId] } } }],
];

for (const [name, freq] of variants) {
  try {
    const { status, text } = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', freq);
    const data = parseAny(text);
    const n = data && data['1'] && Array.isArray(data['1']) ? data['1'].length : 0;
    console.log(`${name.padEnd(18)} HTTP ${status} bytes=${String(text.length).padEnd(6)} ads=${n} nextTok=${data && typeof data['2'] === 'string' ? 'YES' : '-'}`);
    if (n > 0) {
      console.log('  first ad raw:', JSON.stringify(data['1'][0]).slice(0, 2500));
      const urls = JSON.stringify(data['1'][0]).match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
      console.log('  URLs:', [...new Set(urls)].slice(0, 10));
    }
  } catch (e) {
    console.log(`${name.padEnd(18)} ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
