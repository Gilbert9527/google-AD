/**
 * 第三方网站数据富化
 *
 * 免费组合（默认启用）:
 *  - RDAP          域名注册信息（注册商/注册时间=域名年龄）   无需 key
 *  - Wayback CDX   最早网页快照（建站历史）                   无需 key
 *  - Cloudflare Radar  全球域名排名                            需 RADAR_TOKEN（免费）
 *  - CrUX          Google 真实用户体验报告（性能/流量人口覆盖） 需 GOOGLE_API_KEY（免费）
 *  - PageSpeed     Lighthouse 性能评分                         需 GOOGLE_API_KEY（免费，默认关闭）
 *
 * 付费平台（预留接口，配 key 即启用）: SimilarWeb / SpyFu / SEMrush
 */

export interface EnrichResult {
  rdap?: string | null;
  wayback?: string | null;
  crux?: string | null;
  psi?: string | null;
  rank?: number | null;
}

const TIMEOUT = (ms: number) => AbortSignal.timeout(ms);

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, { ...init, signal: TIMEOUT(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// ---------- RDAP ----------

export async function enrichRdap(domain: string): Promise<string | null> {
  const data = (await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`)) as
    | { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: unknown[] }[]; ldhName?: string }
    | null;
  if (!data) return null;
  const registered = data.events?.find((e) => e.eventAction === 'registration')?.eventDate || null;
  const registrar = data.entities?.find((e) => e.roles?.includes('registrar'))?.vcardArray?.[1] as
    | [string, unknown[]]
    | undefined;
  const registrarName = Array.isArray(registrar)
    ? (registrar[1]?.find((x) => Array.isArray(x) && x[0] === 'fn') as unknown[] | undefined)?.[1] ?? null
    : null;
  return JSON.stringify({
    registered,
    registrar: typeof registrarName === 'string' ? registrarName : null,
  });
}

// ---------- Wayback ----------

export async function enrichWayback(domain: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&matchType=domain&fl=timestamp&filter=statuscode:200&limit=1`
  )) as unknown;
  // CDX 返回纯文本 JSON 视参数而定；这里返回数组或文本
  let first: string | null = null;
  if (Array.isArray(data)) {
    const row = (data as unknown[])[0];
    if (Array.isArray(row)) first = String(row[0]);
    else if (typeof row === 'string') first = row;
  } else if (typeof data === 'string') {
    first = data.split('\n')[0]?.trim() || null;
  }
  if (!first) return null;
  const year = first.slice(0, 4);
  return JSON.stringify({ firstSnapshot: first, year: /^\d{4}$/.test(year) ? Number(year) : null });
}

// ---------- Cloudflare Radar ----------

export async function enrichRadar(domain: string, token: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://api.cloudflare.com/client/v4/radar/ranking/domain?name=${encodeURIComponent(domain)}&limit=1`,
    { headers: { authorization: `Bearer ${token}` } }
  )) as { success?: boolean; result?: { ranking?: { rank?: number }[] } } | null;
  if (!data?.success) return null;
  const rank = data.result?.ranking?.[0]?.rank ?? null;
  return JSON.stringify({ rank });
}

// ---------- CrUX ----------

export async function enrichCrux(domain: string, key: string): Promise<string | null> {
  const tryOrigin = async (origin: string) => {
    const res = await fetch(
      `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin }),
        signal: TIMEOUT(12_000),
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  };
  const record = (await tryOrigin(`https://${domain}`)) as
    | { record?: { key?: { origin?: string }; metrics?: Record<string, { percentiles?: { p75?: number }; categories?: Record<string, string> }> } }
    | null;
  if (!record?.record) return null;
  const m = record.record.metrics || {};
  const pick = (name: string) => {
    const v = m[name];
    if (!v) return null;
    return { p75: v.percentiles?.p75 ?? null, cat: v.categories ? Object.values(v.categories)[0] : null };
  };
  return JSON.stringify({
    lcp: pick('largest_contentful_paint'),
    inp: pick('interaction_to_next_paint'),
    cls: pick('cumulative_layout_shift'),
    ttfb: pick('experimental_time_to_first_byte'),
  });
}

// ---------- PageSpeed（可选，默认关闭） ----------

export async function enrichPsi(domain: string, key: string): Promise<string | null> {
  const data = (await fetchJson(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent('https://' + domain)}&key=${encodeURIComponent(key)}&strategy=mobile&category=performance`
  )) as { lighthouseResult?: { categories?: { performance?: { score?: number } } } } | null;
  const score = data?.lighthouseResult?.categories?.performance?.score;
  if (typeof score !== 'number') return null;
  return JSON.stringify({ performance: Math.round(score * 100) });
}

// ---------- 付费平台桩（配置 key 即可启用） ----------

export async function enrichSimilarweb(domain: string, key: string): Promise<string | null> {
  // SimilarWeb 企业 API，需在 developers.similarweb.com 申请；接口形态以贵司合同为准
  const data = await fetchJson(
    `https://api.similarweb.com/v1/website/${encodeURIComponent(domain)}/general/total-traffic?api_key=${encodeURIComponent(key)}`,
    {}
  );
  return data ? JSON.stringify(data).slice(0, 2000) : null;
}

export async function enrichSpyfu(domain: string, key: string): Promise<string | null> {
  // SpyFu API: Google Ads 关键词历史 / 估算月广告花费
  const data = await fetchJson(
    `https://api.spyfu.com/apis/domain_stats_api/v2/domains/get?domain=${encodeURIComponent(domain)}&apiKey=${encodeURIComponent(key)}`,
    {}
  );
  return data ? JSON.stringify(data).slice(0, 2000) : null;
}

export async function enrichSemrush(domain: string, key: string): Promise<string | null> {
  // SEMrush Analytics API v4（按 units 计费）
  const data = await fetchJson('https://api.semrush.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      type: 'domain_ranks',
      key,
      export_columns: 'Dn,Rk,Or,Ot,Oc',
      domain,
      database: 'us',
    }).toString(),
  });
  return data ? JSON.stringify(data).slice(0, 2000) : null;
}
