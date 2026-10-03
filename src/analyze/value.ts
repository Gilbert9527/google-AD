/**
 * 广告价值评估：
 *  - computeAdScore : 广告主侧投放活跃度评分（0-100），来自透明度中心数据
 *  - estimateRevenue: 站长侧 AdSense 收入粗估（流量分层 × 类目 RPM 基准）
 *
 * 诚实边界：流量与收入均为粗估（rank→流量幂律近似 + 公开 RPM 区间），
 * 精确数字需接入 SimilarWeb / SpyFu / SEMrush（providers.ts 已预留桩）。
 */

export interface AdScoreInput {
  adCount: number;               // 指向该域名的广告总数
  firstShown?: number | null;    // 最早展示（秒）
  lastShown?: number | null;     // 最近展示（秒）
  formats?: Set<number>;         // 出现过的创意格式
}

/** 广告活跃度评分 0-100：投放量 × 时效 × 格式多样性 × 投放周期 */
export function computeAdScore(input: AdScoreInput): number {
  const now = Date.now() / 1000;
  // 投放量：1 条≈13 分，1万条封顶 40 分
  const volume = Math.min(40, Math.log10(input.adCount + 1) * 13.3);

  // 时效：最近仍在投≈30 分，逐步衰减
  let recency = 5;
  if (input.lastShown && input.lastShown > 1e9) {
    const days = (now - input.lastShown) / 86400;
    if (days <= 30) recency = 30;
    else if (days <= 90) recency = 22;
    else if (days <= 365) recency = 12;
    else recency = 5;
  }

  // 格式多样性：文字/图片/视频各 5 分
  const diversity = Math.min(15, (input.formats?.size || 0) * 5);

  // 投放周期：持续投得越久分越高
  let lifespan = 0;
  if (input.firstShown && input.lastShown && input.lastShown > 1e9 && input.firstShown > 1e9) {
    const days = (input.lastShown - input.firstShown) / 86400;
    if (days >= 180) lifespan = 15;
    else if (days >= 30) lifespan = 10;
    else if (days >= 7) lifespan = 5;
  }

  return Math.round(Math.min(100, volume + recency + diversity + lifespan));
}

/** AdSense 类目 RPM 基准区间（美元 / 千次展示，美系流量为主的市场公开区间） */
const RPM_BY_CATEGORY: Record<string, [number, number]> = {
  finance: [10, 30],
  crypto: [6, 18],
  gambling: [6, 20],
  health: [5, 14],
  education: [3, 8],
  travel: [3, 8],
  news: [2, 6],
  ecommerce: [2, 6],
  tool: [2, 6],
  blog: [1, 4],
  game: [1.5, 5],
  entertainment: [1, 4],
  social: [1, 3],
  adult: [0.5, 2],
  other: [1, 4],
};

/**
 * rank → 月访问量粗估（公开的幂律近似，量级正确、个位不保证）
 * rank 1k ≈ 5000万/月, 10k ≈ 500万, 100k ≈ 50万, 1M ≈ 5万
 */
export function estimateMonthlyVisits(rank: number): number {
  if (!rank || rank < 1) return 0;
  return Math.round(5e10 / rank);
}

export interface RevenueEstimate {
  visits: number;
  low: number;   // 美元/月
  high: number;
  rpmLow: number;
  rpmHigh: number;
}

/**
 * 站长侧 AdSense 月收入粗估：需要 全球排名 + 分类 + 确认挂 AdSense。
 * 仅展示端收入（AdSense/Ad Manager），不含直售广告与联盟收入。
 */
export function estimateRevenue(input: {
  rank: number | null;
  category: string | null;
  adsense: boolean;
}): RevenueEstimate | null {
  if (!input.adsense || !input.rank || input.rank < 1) return null;
  const visits = estimateMonthlyVisits(input.rank);
  if (!visits) return null;
  const rpm = RPM_BY_CATEGORY[input.category || 'other'] || RPM_BY_CATEGORY.other;
  const round = (v: number) => {
    if (v >= 10000) return Math.round(v / 10000) * 10000;
    if (v >= 1000) return Math.round(v / 100) * 100;
    if (v >= 100) return Math.round(v / 10) * 10;
    return Math.round(v);
  };
  return {
    visits,
    low: round((visits * rpm[0]) / 1000),
    high: round((visits * rpm[1]) / 1000),
    rpmLow: rpm[0],
    rpmHigh: rpm[1],
  };
}
