/**
 * 种子关键词池 v2
 * SearchSuggestions 匹配的是【广告主名称】，因此要用能在广告主名字里出现的
 * 短核心词（casino/slots/loan/shop…），长尾短语（"best ai tool 2026"）命中率极低。
 */

/** 短核心词：一个词命中大量广告主 */
const CORE = [
  // 博彩/游戏
  'casino', 'slots', 'poker', 'bet', 'betting', 'lottery', 'bingo', 'jackpot',
  'game', 'games', 'gaming', 'casino online', 'esports', 'rpg', 'puzzle',
  // 电商/零售
  'shop', 'store', 'fashion', 'shoes', 'clothing', 'jewelry', 'watches',
  'beauty', 'cosmetics', 'skincare', 'supplements', 'vitamins', 'furniture',
  'mattress', 'electronics', 'gadgets', 'toys', 'pets', 'flowers', 'gifts',
  'deals', 'coupons', 'outlet', 'boutique', 'marketplace', 'wholesale',
  // 金融
  'loan', 'loans', 'mortgage', 'insurance', 'credit', 'banking', 'trading',
  'forex', 'investing', 'crypto', 'bitcoin', 'tax', 'debt', 'refinance',
  'payroll', 'accounting', 'funding', 'capital',
  // 健康/医疗
  'health', 'dental', 'clinic', 'pharmacy', 'medical', 'therapy', 'rehab',
  'fitness', 'gym', 'yoga', 'diet', 'weight loss', 'skincare clinic',
  // 旅游
  'travel', 'hotel', 'hotels', 'flights', 'cruise', 'resort', 'tours',
  'vacation', 'booking', 'car rental', 'visa',
  // 教育/职业
  'course', 'courses', 'academy', 'university', 'college', 'tutoring',
  'training', 'certification', 'language', 'resume', 'jobs', 'hiring',
  // 软件/SaaS/网络
  'software', 'app', 'apps', 'saas', 'vpn', 'hosting', 'cloud', 'backup',
  'antivirus', 'crm', 'erp', 'cms', 'website', 'domain', 'email marketing',
  'seo', 'design', 'logo', 'printing', 'translation', 'data recovery',
  // 生活服务
  'plumbing', 'roofing', 'solar', 'cleaning', 'moving', 'landscaping',
  'pest control', 'locksmith', 'repair', 'installation', 'renovation',
  'real estate', 'apartments', 'property', 'rentals', 'lawyer', 'attorney',
  'legal', 'driving school', 'auto repair', 'tires', 'used cars',
  // 媒体/娱乐/社交
  'news', 'magazine', 'streaming', 'movies', 'anime', 'music', 'radio',
  'podcast', 'books', 'novels', 'comics', 'dating', 'chat', 'social',
  'forum', 'blog', 'community', 'celebrity', 'sports', 'football', 'soccer',
  // 中文市场
  '手游', '网游', '传奇', '彩票', '体育', '电竞', '贷款', '保险', '理财',
  '外汇', '期货', '虚拟币', '电商', '购物', '美妆', '医美', '留学', '移民',
  '装修', '家政', '律师', '培训', '教育', '加盟', '建站', '代运营', '推广',
];

/** 二级组合词：核心词 + 轻量后缀（命中率仍可） */
const SUFFIXES = ['online', 'app', 'site', 'shop', 'usa', 'uk', 'india', 'nigeria'];

/** 生成种子关键词列表 */
export function buildKeywordSeeds(): string[] {
  const out = new Set<string>();
  for (const c of CORE) {
    out.add(c);
    for (const s of SUFFIXES) {
      out.add(`${c} ${s}`);
    }
  }
  return [...out];
}

/** 从已发现域名衍生新关键词（扩大抓取面），可周期性调用 */
export function deriveKeywordsFromDomains(domains: string[]): string[] {
  const out: string[] = [];
  for (const d of domains) {
    const base = d.replace(
      /\.(com|net|org|io|co|me|app|xyz|online|site|shop|store|blog|news|top|vip|club|live|fun|space|website|tech|info|biz|us|uk|ca|de|fr|es|it|nl|se|pl|ru|br|in|jp|kr)$/i,
      ''
    );
    if (base.length >= 4 && base.length <= 20 && /^[a-z0-9-]+$/.test(base)) {
      out.push(base);
    }
  }
  return out;
}
