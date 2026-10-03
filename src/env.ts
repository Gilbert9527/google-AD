/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  SEEDS: KVNamespace;
  // secrets
  ADMIN_TOKEN?: string;
  GOOGLE_API_KEY?: string;
  RADAR_TOKEN?: string;
  SIMILARWEB_API_KEY?: string;
  SPYFU_API_KEY?: string;
  SEMRUSH_API_KEY?: string;
  // vars
  TARGET_SITES?: string;
  BATCH_SOURCE_PAGES?: string;
  BATCH_CRAWL_SITES?: string;
  BATCH_ENRICH_SITES?: string;
  BATCH_AI_SITES?: string;
  AI_DAILY_LIMIT?: string;
  SEED_TOPUP_PER_RUN?: string;
  SEED_MIN_PENDING?: string;
  SEED_IMPORT_PER_DAY?: string;
}

export function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
