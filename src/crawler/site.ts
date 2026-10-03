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
  outLinks: string[];            // 首页外链域名（衍生候选，一跳发现）
  error?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HTML_MAX = 400_000; // 截断，防 CPU 超限
const TEXT_MAX = 6000; // 存库正文样本长度

/** 外链发现时排除的枢纽/基础设施域名 */
const HUB_HOSTS = [
  'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net',
  'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'twitter.com',
  'x.com', 'tiktok.com', 'pinterest.com', 'linkedin.com', 'reddit.com',
  'wikipedia.org', 'wikimedia.org', 'amazon.com', 'apple.com', 'microsoft.com',
  'live.com', 'office.com', 'cloudflare.com', 'wordpress.org', 'wordpress.com',
  'wix.com', 'wixsite.com', 'shopify.com', 'blogspot.com', 'medium.com',
  'telegram.me', 't.me', 'discord.gg', 'discord.com', 'github.com', 'gitlab.com',
  'bitbucket.org', 'whatsapp.com', 'weibo.com', 'baidu.com', 'qq.com',
  'tencent.com', 'alibaba.com', 'taobao.com', 'jd.com', 'bilibili.com',
  'zhihu.com', 'douyin.com', 'bytedance.com', 'netease.com', '163.com',
  'sohu.com', 'aliyun.com', 'gravatar.com', 'vimeo.com', 'twitch.tv',
  'spotify.com', 'soundcloud.com', 'flickr.com', 'unsplash.com', 'pexels.com',
  'adobe.com', 'canva.com', 'mailchimp.com', 'hubspot.com', 'cookiebot.com',
  'cloudwaysapps.com', 'squarespace.com', 'godaddy.com', 'namecheap.com',
  'web.archive.org', 'archive.org', 'mozilla.org', 'w3.org', 'schema.org',
  'gmpg.org', 'fontawesome.com', 'jquery.com', 'bootstrapcdn.com',
  'cloudways.com', 'sitelock.com', 'google.bg', 'googletagmanager.com',
];

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
    contentSample: null, outLinks: [], error,
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
      adsense: false, adClient: null, contentSample: null, outLinks: [],
      error: `non-html content-type: ${ct}`,
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

  // Google 广告接入检测：AdSense + Google Publisher Tag + Ad Manager
  const adsense =
    /adsbygoogle|pagead2\.googlesyndication\.com|google_ad_client|ca-pub-\d{8,}|googletag\.pubads\(|securepubads\.g\.doubleclick\.net|partner\.googleadservices\.com|googlesyndication\.com|gpt\.js/i.test(html);
  const adClient =
    html.match(/google_ad_client\s*[:=]\s*["']([^"']+)["']/i)?.[1] ??
    html.match(/data-ad-client=["'](ca-pub-\d{8,})["']/i)?.[1] ??
    html.match(/ca-pub-\d{8,}/i)?.[0] ??
    null;

  // 一跳外链发现：从首页提取外部域名作为新候选（不发额外请求）
  const outLinks: string[] = [];
  const seenLinks = new Set<string>([domain, finalDomain || '']);
  const baseSelf = domain.replace(/\.[a-z]+$/, '');
  const linkRe = /href=["']https?:\/\/([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-z]{2,24})[/"'?]/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null && outLinks.length < 20) {
    let host = lm[1].toLowerCase().replace(/^www\./, '');
    if (seenLinks.has(host)) continue;
    // 同主域的子域不算外链
    if (host === domain || host.endsWith('.' + domain) || (baseSelf.length > 4 && host.includes(baseSelf))) continue;
    if (HUB_HOSTS.some((b) => host === b || host.endsWith('.' + b))) continue;
    if (host.length < 4 || host.split('.').length > 4) continue;
    seenLinks.add(host);
    outLinks.push(host);
  }

  // 提取可见文本样本
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const contentSample = decodeEntities(text).slice(0, TEXT_MAX) || null;

  return { httpStatus, finalUrl, finalDomain, title, description, lang, adsense, adClient, contentSample, outLinks };
}
