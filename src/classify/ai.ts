/**
 * Workers AI 网站深度分析：
 *  - 这个网站是做什么的（summary）
 *  - 主要功能（features）
 *  - 关键词（keywords）
 *  - 校准分类（category）
 *
 * 使用 @cf/meta/llama-3.1-8b-instruct，按日限额控制费用。
 */

export interface AiAnalysis {
  category: string;
  summary: string;
  features: string[];
  keywords: string[];
}

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const VALID_CATEGORIES = new Set([
  'game', 'gambling', 'ecommerce', 'blog', 'news', 'finance', 'crypto',
  'travel', 'education', 'tool', 'entertainment', 'social', 'health',
  'adult', 'other',
]);

function todayKey(): string {
  return `ai_calls_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}

async function bumpAiCounter(db: D1Database): Promise<number> {
  const k = todayKey();
  const row = await db
    .prepare(
      `INSERT INTO kv (k, v) VALUES (?, '1')
       ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT)
       RETURNING v`
    )
    .bind(k)
    .first<string>('v');
  return row ? Number(row) : 1;
}

/** 从模型输出中提取 JSON（模型有时会带 markdown 代码块） */
function parseAiJson(text: string): AiAnalysis | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + 1);
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    const category = String(obj.category || 'other').toLowerCase().trim();
    const features = Array.isArray(obj.features)
      ? obj.features.map((f) => String(f)).filter(Boolean).slice(0, 8)
      : [];
    const keywords = Array.isArray(obj.keywords)
      ? obj.keywords.map((k) => String(k)).filter(Boolean).slice(0, 10)
      : [];
    return {
      category: VALID_CATEGORIES.has(category) ? category : 'other',
      summary: String(obj.summary || '').slice(0, 300),
      features,
      keywords,
    };
  } catch {
    return null;
  }
}

export interface AnalyzeInput {
  domain: string;
  title?: string | null;
  description?: string | null;
  lang?: string | null;
  adsense?: boolean;
  content?: string | null;
}

export async function analyzeWithAI(
  db: D1Database,
  ai: Ai,
  input: AnalyzeInput,
  dailyLimit: number
): Promise<AiAnalysis | null> {
  const used = await bumpAiCounter(db);
  if (used > dailyLimit) return null;

  const content = (input.content || '').slice(0, 3500);
  const prompt = `分析以下网站，用简体中文回答。

域名: ${input.domain}
标题: ${input.title || '(无)'}
描述: ${input.description || '(无)'}
页面正文样本:
${content || '(无)'}

请严格只输出一个 JSON 对象（不要 markdown、不要解释），格式：
{"category":"<分类>","summary":"<50字以内：这个网站是做什么的>","features":["<主要功能1>","<主要功能2>"],"keywords":["<关键词1>","<关键词2>"]}

category 只能从以下选一个：
game(游戏) gambling(博彩) ecommerce(电商) blog(博客) news(新闻资讯) finance(金融) crypto(加密货币) travel(旅游) education(教育) tool(工具软件) entertainment(影音娱乐) social(社交社区) health(健康医疗) adult(成人) other(其他)`;

  try {
    const res = (await ai.run(MODEL, {
      messages: [
        { role: 'system', content: '你是网站分析专家，只输出 JSON，不输出任何其他内容。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.2,
    })) as { response?: string };

    return parseAiJson(res?.response || '');
  } catch {
    return null;
  }
}
