/** 生产环境 API 调用小工具: node scripts/call-api.mjs <path> [method] [body] */
const BASE = 'https://google-ad-platform.jiajifei66.workers.dev';
const TOKEN = '7a8810a7e05ef386eaca4bd2d4152da9';

const path = process.argv[2] || '/api/stats';
const method = process.argv[3] || 'GET';
const body = process.argv[4] || null;

const headers = { 'content-type': 'application/json' };
if (path.startsWith('/api/admin')) headers['x-admin-token'] = TOKEN;

const res = await fetch(BASE + path, {
  method,
  headers,
  body: body && method !== 'GET' ? body : undefined,
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text.slice(0, 4000));
