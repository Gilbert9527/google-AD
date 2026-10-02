/** 用浏览器抓到的真实请求体格式测试 SearchCreatives */
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

const tests = [
  ['kw full7', { 2: 20, 3: { 12: { 1: 'online casino', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 } }],
  ['kw 7no3', { 2: 20, 3: { 12: { 1: 'online casino', 2: true } }, 7: { 1: 1, 2: 0 } }],
  ['kw 7old', { 2: 20, 3: { 12: { 1: 'online casino', 2: true } }, 7: { 1: 1 } }],
  ['kw no7', { 2: 20, 3: { 12: { 1: 'online casino', 2: true } } }],
  ['dom full7', { 2: 20, 3: { 12: { 1: 'casino.org', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 } }],
  ['adv full7', { 2: 20, 3: { 12: { 1: '', 2: true }, 13: { 1: ['AR12898764994459467777'] } }, 7: { 1: 1, 2: 0, 3: 2392 } }],
  ['zh kw', { 2: 20, 3: { 12: { 1: '手游', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 } }],
];

for (const [name, freq] of tests) {
  try {
    const { status, text } = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', freq);
    const data = parseAny(text);
    const n = data && Array.isArray(data['1']) ? data['1'].length : 0;
    const tok = data && typeof data['2'] === 'string' ? 'YES' : '-';
    console.log(`${name.padEnd(10)} HTTP ${status} bytes=${String(text.length).padEnd(7)} ads=${n} nextTok=${tok}`);
    if (n > 0) {
      const ad = data['1'][0];
      console.log('  AD[0] keys:', Object.keys(ad).slice(0, 25).join(','));
      console.log('  AD[0]:', JSON.stringify(ad).slice(0, 1800));
    } else {
      console.log('  resp:', text.slice(0, 200));
    }
  } catch (e) {
    console.log(`${name.padEnd(10)} ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 700));
}
