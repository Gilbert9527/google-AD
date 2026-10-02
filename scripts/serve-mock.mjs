/** 前端 UI 验证服务器：静态资源 + Mock API（不依赖 wrangler） */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const sites = [
  { domain: 'casino-x.net', title: 'Casino X - Best Online Slots', description: 'Play 500+ online slots', category: 'gambling', categoryLabel: '博彩', summary: 'Casino X 是一个在线博彩娱乐网站，提供 500 多种老虎机、二十一点和轮盘游戏。', adsense: true, adCount: 3184, rank: null, lang: 'en', firstSeen: 1790800000000, lastCrawled: 1790900000000 },
  { domain: 'freshblog.io', title: 'FreshBlog - Ideas about tech and life', description: 'A personal blog', category: 'blog', categoryLabel: '博客', summary: 'FreshBlog 是一个个人技术博客，分享编程技巧、效率工具与生活思考。', adsense: false, adCount: 12, rank: 812345, lang: 'en', firstSeen: 1790810000000, lastCrawled: 1790901000000 },
  { domain: 'gearshop.com', title: 'GearShop - Outdoor Equipment Store', description: 'Tents and backpacks', category: 'ecommerce', categoryLabel: '电商', summary: 'GearShop 是一家户外装备电商网站，出售帐篷、背包等露营用品。', adsense: true, adCount: 204, rank: 95432, lang: 'en', firstSeen: 1790820000000, lastCrawled: 1790902000000 },
  { domain: 'cryptodaily.co', title: 'Crypto Daily News', description: 'Bitcoin and blockchain news', category: 'crypto', categoryLabel: '加密货币', summary: 'Crypto Daily 提供比特币、区块链行业的每日新闻与行情分析。', adsense: false, adCount: 86, rank: null, lang: 'en', firstSeen: 1790830000000, lastCrawled: 1790903000000 },
  { domain: 'learnpy.org', title: 'Learn Python - Interactive Tutorial', description: 'Free interactive python course', category: 'education', categoryLabel: '教育', summary: 'LearnPy 提供免费的 Python 交互式教程与在线练习环境。', adsense: true, adCount: 45, rank: 231990, lang: 'en', firstSeen: 1790840000000, lastCrawled: 1790904000000 },
];

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  res.setHeader('access-control-allow-origin', '*');
  if (p === '/api/stats') {
    const byCategory = {};
    for (const s of sites) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      target: 60000, total: 48213, crawled: 12402, adsense: 3211, advertisers: 18745,
      keywordsLeft: 1204, enrichLeft: 3120, lastCrawlAt: Date.now(),
      byCategory: Object.entries(byCategory).map(([category, count]) => ({ category, label: { gambling: '博彩', blog: '博客', ecommerce: '电商', crypto: '加密货币', education: '教育' }[category], count })),
    }));
    return;
  }
  if (p === '/api/sites') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const cat = url.searchParams.get('category') || '';
    let items = sites.filter((s) => (!q || s.domain.includes(q) || (s.title || '').toLowerCase().includes(q) || (s.summary || '').includes(q)) && (!cat || s.category === cat));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ total: items.length, page: 1, pageSize: 20, items }));
    return;
  }
  if (p.startsWith('/api/sites/')) {
    const domain = p.split('/')[3];
    const s = sites.find((x) => x.domain === domain) || sites[0];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      domain: s.domain, transparencyUrl: 'https://adstransparency.google.com/?region=anywhere&domain=' + s.domain,
      status: 'ok', httpStatus: 200, finalUrl: 'https://' + s.domain + '/', title: s.title, description: s.description,
      lang: s.lang, adsense: s.adsense, adClient: s.adsense ? 'ca-pub-1234567890' : null, adCount: s.adCount,
      category: s.category, categoryLabel: s.categoryLabel, categorySource: 'heuristic',
      ai: { summary: s.summary, features: ['功能一', '功能二', '功能三'], keywords: ['关键词1', '关键词2'], analyzedAt: Date.now() },
      data: { rank: s.rank, rdap: { registered: '2019-03-12T00:00:00Z', registrar: 'NameCheap Inc.' }, wayback: { year: 2019 }, crux: null },
      firstSeen: s.firstSeen, lastCrawled: s.lastCrawled,
      creatives: [
        { creativeId: 'CR06868540226935980033', advertiserId: 'AR07816964328396947457', advertiserName: 'ELEMENTARY INNOVATION PTE. LTD.', format: 1, firstShown: 1788526202, lastShown: 1790946074 },
        { creativeId: 'CR01607921896039383041', advertiserId: 'AR07816964328396947457', advertiserName: 'ELEMENTARY INNOVATION PTE. LTD.', format: 2, firstShown: 1785924923, lastShown: 1790946062 },
      ],
    }));
    return;
  }
  if (p === '/api/categories') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(sites.reduce((a, s) => { const f = a.find((x) => x.category === s.category); if (f) f.count++; else a.push({ category: s.category, label: s.categoryLabel, count: 1 }); return a; }, [])));
    return;
  }
  // 静态资源
  let file = p === '/' ? '/index.html' : p;
  const path = join(ROOT, file);
  if (existsSync(path)) {
    res.setHeader('content-type', MIME[extname(path)] || 'application/octet-stream');
    res.end(readFileSync(path));
  } else {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(8811, () => console.log('mock UI server on http://127.0.0.1:8811'));
