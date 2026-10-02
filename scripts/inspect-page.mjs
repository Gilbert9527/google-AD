const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
import { writeFileSync } from 'node:fs';

const res = await fetch(`${BASE}/?hl=en&region=anywhere`, { headers: { 'user-agent': UA } });
const html = await res.text();
writeFileSync('D:/code/google-AD/scripts/page.html', html);
console.log('HTML length:', html.length, 'status:', res.status);
// 找所有 JS 资源引用
const refs = [
  ...html.matchAll(/<script[^>]*>/g),
].map((m) => m[0]);
console.log('script tags:', refs.length);
for (const r of refs.slice(0, 20)) console.log('  ', r.slice(0, 200));
const links = [...html.matchAll(/(?:src|href)=["']([^"']{5,200})["']/g)].map((m) => m[1]).filter((u) => u.includes('.js') || u.includes('js/') || u.includes('/_'));
console.log('js-ish refs:', [...new Set(links)].slice(0, 40));
