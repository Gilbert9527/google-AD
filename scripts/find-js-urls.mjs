import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('D:/code/google-AD/scripts/page.html', 'utf8');
// 任意 .js 引用
const re = /["']([^"']{6,300}\.js[^"']{0,40})["']/g;
const seen = new Set();
let m;
while ((m = re.exec(html))) {
  if (!seen.has(m[1])) {
    seen.add(m[1]);
    console.log(m[1].slice(0, 200));
  }
}
console.log('--- total', seen.size);
// 也找 base64/加密的 UI 数据里的 "wrb.fr" rpc 调用样例
for (const kw of ['wrb.fr', 'MkEWBc', 'AF_initDataCallback', 'sideChannel', 'RpcEndpoint']) {
  const p = html.indexOf(kw);
  console.log('kw', JSON.stringify(kw), '@', p);
  if (p >= 0) console.log(html.slice(Math.max(0, p - 200), p + 400).replace(/\n/g, ' ').slice(0, 500), '\n');
}
