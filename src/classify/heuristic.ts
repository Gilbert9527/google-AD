/**
 * 启发式分类器：基于标题/描述/域名/正文的关键词打分。
 * 零成本、毫秒级，作为 Workers AI 之外的兜底与第一道分类。
 */

export const CATEGORIES = [
  'game', 'gambling', 'ecommerce', 'blog', 'news', 'finance', 'crypto',
  'travel', 'education', 'tool', 'entertainment', 'social', 'health',
  'adult', 'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** UI 展示名（中文） */
export const CATEGORY_LABELS: Record<Category, string> = {
  game: '游戏',
  gambling: '博彩',
  ecommerce: '电商',
  blog: '博客',
  news: '新闻资讯',
  finance: '金融',
  crypto: '加密货币',
  travel: '旅游',
  education: '教育',
  tool: '工具软件',
  entertainment: '影音娱乐',
  social: '社交社区',
  health: '健康医疗',
  adult: '成人',
  other: '其他',
};

const KW: Record<Exclude<Category, 'other'>, string[]> = {
  game: ['game', 'games', 'gaming', 'gamer', 'jeux', 'spiel', 'juego', 'gioco',
    'rpg', 'mmo', 'fps', 'puzzle', 'casual game', 'play now', 'leaderboard',
    '手游', '网游', '游戏', '传奇', '页游', '开服', '电竞', '攻略'],
  gambling: ['casino', 'slot', 'slots', 'bet', 'betting', 'poker', 'lottery',
    'bingo', 'jackpot', 'vegas', 'roulette', 'blackjack', 'odds', 'wager',
    'toto', 'sbobet', 'csgo', 'bookmaker', 'scratch card',
    '博彩', '赌场', '彩票', '扑克', '体育投注', '六合彩'],
  ecommerce: ['shop', 'store', 'buy', 'cart', 'checkout', 'deal', 'deals',
    'discount', 'coupon', 'sale', 'price', 'order', 'shipping', 'shopify',
    'woocommerce', 'marketplace', 'product', 'free shipping', 'best price',
    '商城', '商店', '购物', '优惠券', '折扣', '特卖', '包邮', '正品'],
  blog: ['blog', 'blogger', 'diary', 'articles', 'my thoughts', 'personal website',
    'i write', 'weekly', 'newsletter', 'journal', 'musings', 'essay',
    '博客', '随笔', '日记', '个人站', '专栏'],
  news: ['news', 'breaking', 'headline', 'magazine', 'daily', 'press', 'reporter',
    'editorial', 'politics', 'world news', 'latest news', 'top stories',
    '新闻', '资讯', '头条', '快讯', '日报', '早报', '晚报', '报道'],
  finance: ['loan', 'loans', 'mortgage', 'insurance', 'credit', 'banking', 'bank',
    'invest', 'investing', 'trading', 'stocks', 'forex', 'tax', 'accounting',
    'payroll', 'debt', 'refinance', 'financial', 'wealth', 'funding',
    '贷款', '信贷', '保险', '理财', '证券', '开户', '配资', '财税', '记账'],
  crypto: ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'blockchain', 'nft',
    'web3', 'token', 'wallet', 'defi', 'mining', 'altcoin', 'coin',
    '加密', '区块链', '数字货币', '比特币', '以太坊', '挖矿'],
  travel: ['travel', 'hotel', 'hotels', 'flight', 'flights', 'tour', 'tourism',
    'booking', 'resort', 'vacation', 'trip', 'cruise', 'hostel', 'airbnb',
    'visa', 'airport', 'destinations',
    '旅游', '酒店', '机票', '签证', '度假', '民宿', '攻略', '自由行'],
  education: ['course', 'courses', 'learn', 'learning', 'academy', 'school',
    'university', 'college', 'tutorial', 'training', 'study', 'exam',
    'certification', 'bootcamp', 'lesson', 'teacher', 'student',
    '课程', '培训', '学校', '教育', '学习', '学院', '考研', '留学', '网课'],
  tool: ['tool', 'tools', 'software', 'app', 'download', 'converter', 'calculator',
    'generator', 'editor', 'converter', 'sdk', 'api', 'platform', 'saas',
    'dashboard', 'automation', 'template', 'extension', 'plugin', 'utility',
    '工具', '软件', '下载', '转换', '在线生成', '管理系统', '建站', '源码'],
  entertainment: ['movie', 'movies', 'film', 'tv', 'stream', 'streaming', 'watch',
    'anime', 'manga', 'music', 'song', 'video', 'drama', 'series', 'episode',
    'comics', 'novel', 'funny', 'meme', 'celebrity', 'gossip',
    '电影', '影视', '剧集', '动漫', '音乐', '综艺', '直播', '小说', '漫画'],
  social: ['dating', 'chat', 'community', 'forum', 'social', 'friends', 'meet',
    'singles', 'relationship', 'network', 'members', 'profile', 'group',
    '社交', '交友', '社区', '论坛', '相亲', '聊天', '单身'],
  health: ['health', 'medical', 'clinic', 'doctor', 'dental', 'dentist', 'therapy',
    'treatment', 'medicine', 'pharmacy', 'fitness', 'gym', 'diet', 'nutrition',
    'wellness', 'supplement', 'yoga', 'skincare', 'patient', 'symptoms',
    '健康', '医疗', '医院', '牙科', '整形', '养生', '健身', '减肥', '保健品', '问诊'],
  adult: ['xxx', 'porn', 'sex', 'escort', 'adult', 'nsfw', 'cams', 'hookup',
    'nude', 'erotic', 'fetish', '18+'],
};

export interface HeuristicResult {
  category: Category;
  confidence: number;
}

export function classifyHeuristic(input: {
  domain?: string | null;
  title?: string | null;
  description?: string | null;
  content?: string | null;
}): HeuristicResult {
  const domain = (input.domain || '').toLowerCase();
  const title = (input.title || '').toLowerCase();
  const desc = (input.description || '').toLowerCase();
  const content = (input.content || '').toLowerCase().slice(0, 3000);

  const scores = new Map<Category, number>();
  const bump = (c: Category, n: number) => scores.set(c, (scores.get(c) || 0) + n);

  const hitIn = (text: string, kws: string[]) => {
    let hits = 0;
    for (const kw of kws) {
      if (text.includes(kw)) hits++;
      if (hits >= 4) break;
    }
    return hits;
  };

  for (const [cat, kws] of Object.entries(KW) as [Exclude<Category, 'other'>, string[]][]) {
    const t = hitIn(title, kws);
    if (t) bump(cat, t * 3);
    const d = hitIn(desc, kws);
    if (d) bump(cat, d * 2);
    const dm = hitIn(domain.replace(/\./g, ' '), kws);
    if (dm) bump(cat, dm * 2);
    const c = hitIn(content, kws);
    if (c) bump(cat, c);
  }

  let best: Category = 'other';
  let bestScore = 0;
  let second = 0;
  for (const [cat, s] of scores) {
    if (s > bestScore) {
      second = bestScore;
      best = cat;
      bestScore = s;
    } else if (s > second) {
      second = s;
    }
  }

  if (bestScore < 2) return { category: 'other', confidence: 0 };
  // 置信度：主类得分与总得分的占比
  let total = 0;
  for (const s of scores.values()) total += s;
  const confidence = Math.min(1, bestScore / Math.max(total, 1));
  return { category: best, confidence: Number(confidence.toFixed(2)) };
}
