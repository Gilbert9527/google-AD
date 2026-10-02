/** 模拟完整浏览器头重试 SearchCreatives */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getSession() {
  const res = await fetch(`${BASE}/?hl=en&region=anywhere`, {
    headers: {
      'user-agent': UA,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    },
  });
  const cookies = [];
  for (const [k, v] of res.headers.entries()) if (k === 'set-cookie') cookies.push(v.split(';')[0]);
  return cookies.join('; ');
}

async function post(cookie, freq, extra = {}, authuser = '') {
  const body = new URLSearchParams({ 'f.req': JSON.stringify(freq) }).toString();
  const headers = {
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'user-agent': UA,
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    'origin': BASE,
    'referer': `${BASE}/?hl=en&region=anywhere`,
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
  if (cookie) headers['cookie'] = cookie;
  const res = await fetch(`${BASE}/anji/_/rpc/SearchService/SearchCreatives?authuser=${authuser}`, {
    method: 'POST', headers, body,
  });
  const text = await res.text();
  const setCookies = [];
  for (const [k, v] of res.headers.entries()) if (k === 'set-cookie') setCookies.push(v);
  return { status: res.status, text, setCookies };
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

const freq = { 2: 20, 3: { 12: { 1: 'online casino', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 } };

const cookie = await getSession();
console.log('session cookies:', cookie.length, 'bytes');

const combos = [
  ['plain+cookie', {}],
  ['x-same-domain', { 'x-same-domain': '1' }],
  ['x-same-dom+authuser0', { 'x-same-domain': '1' }, '0'],
  ['xhr-requested-with', { 'x-requested-with': 'XMLHttpRequest' }],
  ['x-goog-api-key', { 'x-goog-api-key': 'AIzaSyCQ8D0Y4sO2Kl3r1MKDL6fA3jbB1a9FnCo' }],
];

for (const [name, extra, au] of combos) {
  try {
    const { status, text } = await post(cookie, freq, extra, au || '');
    const data = parseAny(text);
    const n = data && Array.isArray(data['1']) ? data['1'].length : 0;
    console.log(`${name.padEnd(22)} HTTP ${status} bytes=${String(text.length).padEnd(7)} ads=${n}`);
    if (n > 0) console.log('  AD[0]:', JSON.stringify(data['1'][0]).slice(0, 1500));
  } catch (e) {
    console.log(`${name.padEnd(22)} ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 700));
}
