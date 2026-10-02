/**
 * 透明度中心逆向 API 结构验证脚本（本地 Node 运行，不入 Worker 包）
 * 用法: node scripts/test-atc.mjs "keyword"
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
  console.log('status:', res.status, 'cookies:', cookies.length);
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
  console.log(`\n=== ${path} -> HTTP ${res.status}, ${text.length} bytes ===`);
  return { res, text };
}

function firstJson(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    const i = line.indexOf('[');
    if (i === -1) continue;
    try {
      return JSON.parse(line.slice(i).trim());
    } catch {}
  }
  return null;
}

const cookie = await getSession();
const kw = process.argv[2] || 'online casino';

// 1) SearchSuggestions
{
  const { text } = await post(cookie, '/anji/_/rpc/SearchService/SearchSuggestions', {
    1: kw, 2: 10, 3: 10,
  });
  const data = firstJson(text);
  if (!data) {
    console.log('SUGGESTIONS: NO JSON. First 800 chars:\n', text.slice(0, 800));
  } else {
    console.log('SUGGESTIONS top-level type:', Array.isArray(data) ? 'array' : typeof data,
      'len:', data.length);
    console.log('SUGGESTIONS[0] sample:', JSON.stringify(data?.[0])?.slice(0, 600));
  }
}

// 2) SearchCreatives by keyword
{
  const { text } = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', {
    2: 10, 3: { 12: { 1: kw, 2: true } }, 7: { 1: 1 },
  });
  const data = firstJson(text);
  if (!data) {
    console.log('CREATIVES: NO JSON. First 800 chars:\n', text.slice(0, 800));
  } else {
    console.log('CREATIVES top-level keys:', Object.keys(data).slice(0, 20));
    const arr = data['1'];
    console.log('CREATIVES list is array:', Array.isArray(arr), 'len:', Array.isArray(arr) ? arr.length : '-');
    console.log('CREATIVES next-token field "2":', typeof data['2'] === 'string' ? data['2'].slice(0, 80) : JSON.stringify(data['2'])?.slice(0, 120));
    if (Array.isArray(arr) && arr.length) {
      const ad = arr[0];
      console.log('\nAD[0] top keys:', Object.keys(ad).slice(0, 30));
      console.log('AD[0] ["1"] (advertiserId?):', JSON.stringify(ad['1'])?.slice(0, 120));
      console.log('AD[0] ["2"] (creativeId?):', JSON.stringify(ad['2'])?.slice(0, 120));
      console.log('AD[0] ["8"] (format?):', JSON.stringify(ad['8'])?.slice(0, 200));
      console.log('AD[0] ["4"]:', JSON.stringify(ad['4'])?.slice(0, 200));
      console.log('AD[0] ["5"]:', JSON.stringify(ad['5'])?.slice(0, 200));
      console.log('\nAD[0] full raw (3000 chars):\n', JSON.stringify(ad).slice(0, 3000));
      // 提取 URL 看落地页
      const urls = JSON.stringify(ad).match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
      console.log('\nAD[0] URLs found:', [...new Set(urls)].slice(0, 12));
    }
  }
}
