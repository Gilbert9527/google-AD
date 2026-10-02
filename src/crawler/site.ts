/**
 * 站点爬虫：抓取首页 HTML，提取标题/描述/语言/正文样本，
 * 并检测是否挂载 Google AdSense 广告代码。
 */

export interface SiteCrawl {
  httpStatus: number | null;
  finalUrl: string | null;
  finalDomain: string | null;
  title: string | null;
  description: string | null;
  lang: string | null;
  adsense: boolean;
  adClient: string | null;
  contentSample: string | null;
  error?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HTML_MAX = 400_000; // 截断，防 CPU 超限
const TEXT_MAX = 6000; // 存库正文样本长度

function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
      if (code[0] === '#') {
        const num =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        if (!Number.isFinite(num) || num < 1 || num > 0x10ffff) return '';
        try {
          return String.fromCodePoint(num);
        } catch {
          return '';
        }
      }
      const map: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
        rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', middot: '·',
      };
      return map[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  d = d.replace(/^www\./, '');
  if (d.endsWith('.')) d = d.slice(0, -1);
  return d;
}

export async function crawlSite(domain: string): Promise<SiteCrawl> {
  const fail = (error: string): SiteCrawl => ({
    httpStatus: null, finalUrl: null, finalDomain: null, title: null,
    description: null, lang: null, adsense: false, adClient: null,
    contentSample: null, error,
  });
  const url = `https://${domain}/`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': BROWSER_UA,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // https 失败再试 http
    try {
      res = await fetch(`http://${domain}/`, {
        headers: { 'user-agent': BROWSER_UA, 'accept': 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  const httpStatus = res.status;
  const finalUrl = res.url || url;
  let finalDomain: string | null = null;
  try {
    finalDomain = normalizeDomain(new URL(finalUrl).hostname);
  } catch {
    finalDomain = domain;
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html') && !ct.includes('xml') && !ct.includes('text')) {
    return {
      httpStatus, finalUrl, finalDomain, title: null, description: null, lang: null,
      adsense: false, adClient: null, contentSample: null, error: `non-html content-type: ${ct}`,
    };
  }

  let html: string;
  try {
    html = await res.text();
    if (html.length > HTML_MAX) html = html.slice(0, HTML_MAX);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]{0,600}?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).slice(0, 300) : null;

  let description: string | null = null;
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,500})["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']{0,500})["'][^>]*name=["']description["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{0,500})["']/i);
  if (descMatch) description = decodeEntities(descMatch[1]).slice(0, 400);

  const langMatch = html.match(/<html[^>]+lang=["']([a-zA-Z-]{2,10})["']/i);
  const lang = langMatch ? langMatch[1].toLowerCase() : null;

  const adsense =
    /adsbygoogle|pagead2\.googlesyndication\.com|google_ad_client|ca-pub-\d{8,}/i.test(html);
  const adClient =
    html.match(/google_ad_client\s*[:=]\s*["']([^"']+)["']/i)?.[1] ??
    html.match(/ca-pub-\d{8,}/i)?.[0] ??
    null;

  // 提取可见文本样本
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const contentSample = decodeEntities(text).slice(0, TEXT_MAX) || null;

  return { httpStatus, finalUrl, finalDomain, title, description, lang, adsense, adClient, contentSample };
}
