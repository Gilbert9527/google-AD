/** 验证 GetCreativeById 详情 + 按广告主名称搜索 是否能拿到落地域名 */
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
const ADV = 'AR07816964328396947457'; // temu

// 1) 先拿该广告主的一个创意 ID
const list = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', {
  2: 3, 3: { 12: { 1: '', 2: true }, 13: { 1: [ADV] } }, 7: { 1: 1, 2: 0, 3: 2392 },
});
const creativeId = list?.['1']?.[0]?.['2'];
console.log('creative:', creativeId);

// 2) GetCreativeById 详情
const detail = await post(cookie, '/anji/_/rpc/LookupService/GetCreativeById', {
  1: ADV, 2: creativeId, 5: { 1: 1 },
});
const ad = detail?.['1'];
if (ad) {
  const raw = JSON.stringify(ad);
  console.log('detail keys:', Object.keys(ad).join(','));
  console.log('detail len:', raw.length);
  const urls = raw.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
  console.log('detail URLs:', [...new Set(urls)].slice(0, 15));
  console.log('detail head:', raw.slice(0, 2200));
}

// 3) 按广告主名称搜索（看响应是否带 "14" 域名标注）
const byName = await post(cookie, '/anji/_/rpc/SearchService/SearchCreatives', {
  2: 5, 3: { 12: { 1: 'Elementary Innovation', 2: true } }, 7: { 1: 1, 2: 0, 3: 2392 },
});
const ads2 = byName?.['1'] || [];
console.log('\nby-name ads:', ads2.length);
if (ads2.length) {
  console.log('by-name[0] keys:', Object.keys(ads2[0]).join(','));
  console.log('by-name[0] "14":', ads2[0]['14']);
}
