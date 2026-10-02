/**
 * 从透明度中心前端 JS 包中定位 SearchCreatives 的真实请求构造
 */
const BASE = 'https://adstransparency.google.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
import { writeFileSync } from 'node:fs';

const res = await fetch(`${BASE}/?hl=en&region=anywhere`, {
  headers: { 'user-agent': UA },
});
const html = await res.text();
const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
console.log('scripts found:', scripts.length);
for (const s of scripts) console.log('  ', s.slice(0, 160));

let idx = 0;
for (const s of scripts) {
  const url = s.startsWith('http') ? s : s.startsWith('//') ? 'https:' + s : new URL(s, BASE).href;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    const js = await r.text();
    const i = js.indexOf('SearchCreatives');
    console.log(`\n[${idx}] ${url.slice(0, 120)} len=${js.length} SearchCreatives@${i}`);
    if (i >= 0) {
      writeFileSync(`D:/code/google-AD/scripts/bundle-${idx}.js`, js);
      console.log('  saved to scripts/bundle-' + idx + '.js');
      // 打印出现点上下文
      let p = i;
      let count = 0;
      while (p >= 0 && count < 8) {
        console.log('\n--- context @', p, '---\n', js.slice(Math.max(0, p - 700), p + 700));
        p = js.indexOf('SearchCreatives', p + 1);
        count++;
      }
    }
    idx++;
  } catch (e) {
    console.log(`[${idx}] fetch fail ${e.message}`);
    idx++;
  }
}
