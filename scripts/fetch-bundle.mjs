import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
const URL_BUNDLE =
  'https://www.gstatic.com/acx/transparency/report/acx-tfaar-tfaa-report-ui-frontend_auto_20260928-0645_RC000/main.dart.js';
const OUT = 'D:/code/google-AD/scripts/main.dart.js';

if (!existsSync(OUT) || statSync(OUT).size < 100000) {
  const res = await fetch(URL_BUNDLE, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36' },
  });
  const js = await res.text();
  writeFileSync(OUT, js);
  console.log('downloaded', js.length, 'bytes, status', res.status);
} else {
  console.log('cached', statSync(OUT).size);
}

const js = readFileSync(OUT, 'utf8');
for (const kw of [
  'SearchCreatives', 'SearchSuggestions', 'GetCreativeById', 'batchexecute',
  'anji', 'f.req', 'SearchService', 'LookupService',
]) {
  let p = js.indexOf(kw);
  console.log('kw', JSON.stringify(kw), 'first@', p, 'hits:', js.split(kw).length - 1);
}
