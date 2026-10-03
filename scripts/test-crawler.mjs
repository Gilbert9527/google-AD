/** 验证站点爬虫 + 启发式分类（真实站点） */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
      if (code[0] === '#') {
        const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        if (!Number.isFinite(num)) return '';
        try { return String.fromCodePoint(num); } catch { return ''; }
      }
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      return map[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

async function crawl(domain) {
  const url = `https://${domain}/`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  let html = await res.text();
  if (html.length > 400000) html = html.slice(0, 400000);
  const title = html.match(/<title[^>]*>([\s\S]{0,600}?)<\/title>/i)?.[1];
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1];
  const lang = html.match(/<html[^>]+lang=["']([a-zA-Z-]{2,10})["']/i)?.[1];
  const adsense = /adsbygoogle|pagead2\.googlesyndication\.com|google_ad_client|ca-pub-\d{8,}/i.test(html);
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const content = decodeEntities(text).slice(0, 3000);
  return { status: res.status, title: decodeEntities(title || ''), desc: decodeEntities(desc || ''), lang, adsense, content };
}

// 与 src/classify/heuristic.ts 相同的核心词表（精简版，用于验证）
const KW = {
  game: ['game', 'games', 'gaming', 'play now', '手游', '游戏'],
  gambling: ['casino', 'slot', 'bet', 'poker', 'lottery', '博彩'],
  ecommerce: ['shop', 'store', 'buy', 'cart', 'deals', 'shipping', '商城', '购物'],
  blog: ['blog', 'articles', 'diary', '博客'],
  news: ['news', 'breaking', 'headline', '新闻'],
  finance: ['loan', 'insurance', 'credit', 'trading', 'invest', '贷款', '保险'],
  crypto: ['crypto', 'bitcoin', 'blockchain', '加密', '区块链'],
  travel: ['travel', 'hotel', 'flight', 'booking', '旅游', '酒店'],
  education: ['course', 'learn', 'education', 'tutorial', '课程', '学习'],
  tool: ['software', 'tool', 'download', 'converter', '工具', '软件'],
  entertainment: ['movie', 'stream', 'music', 'video', '影视', '音乐'],
  social: ['dating', 'chat', 'community', 'forum', '社交', '社区'],
  health: ['health', 'medical', 'dental', 'fitness', '健康', '医疗'],
};

function classify(input) {
  const title = (input.title || '').toLowerCase();
  const desc = (input.desc || '').toLowerCase();
  const content = (input.content || '').toLowerCase();
  const domain = (input.domain || '').toLowerCase();
  const scores = new Map();
  const bump = (c, n) => scores.set(c, (scores.get(c) || 0) + n);
  const hits = (text, kws) => { let h = 0; for (const kw of kws) { if (text.includes(kw)) h++; if (h >= 4) break; } return h; };
  for (const [cat, kws] of Object.entries(KW)) {
    const t = hits(title, kws); if (t) bump(cat, t * 3);
    const d = hits(desc, kws); if (d) bump(cat, d * 2);
    const dm = hits(domain.replace(/\./g, ' '), kws); if (dm) bump(cat, dm * 2);
    const c = hits(content, kws); if (c) bump(cat, c);
  }
  let best = 'other', bs = 0;
  for (const [c, s] of scores) if (s > bs) { bs = s; best = c; }
  return { best, score: bs };
}

const targets = [['wikipedia.org', 'news'], ['pcgamer.com', 'game'], ['booking.com', 'travel'], ['coinmarketcap.com', 'crypto'], ['coursera.org', 'education']];
for (const [domain] of targets) {
  try {
    const r = await crawl(domain);
    const cls = classify({ domain, title: r.title, desc: r.desc, content: r.content });
    console.log(`${domain.padEnd(20)} HTTP ${r.status} adsense=${r.adsense ? 'Y' : 'N'} -> ${cls.best} (score ${cls.score}) | ${r.title.slice(0, 60)}`);
  } catch (e) {
    console.log(`${domain.padEnd(20)} ERROR ${e.message.slice(0, 60)}`);
  }
  await new Promise((r2) => setTimeout(r2, 800));
}
