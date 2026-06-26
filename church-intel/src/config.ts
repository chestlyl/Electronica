import 'dotenv/config';

function num(key: string, def: number): number {
  const v = process.env[key];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return def;
  return /^(1|true|yes)$/i.test(v);
}

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
  },
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    inputCostPerMTok: num('CLAUDE_INPUT_COST_PER_MTOK', 3),
    outputCostPerMTok: num('CLAUDE_OUTPUT_COST_PER_MTOK', 15),
    // Write each raw Claude response to data/debug/last-claude-response.txt.
    debug: bool('CLAUDE_DEBUG', false),
  },
  crawl: {
    userAgent:
      process.env.CRAWLER_USER_AGENT ??
      'ChurchIntelBot/1.0 (+https://millionmemberchurch.org/bot)',
    delayMs: num('CRAWL_DELAY_MS', 2000),
    maxPagesPerSite: num('MAX_PAGES_PER_SITE', 10),
    pageTimeoutMs: num('PAGE_TIMEOUT_MS', 20000),
    headless: bool('HEADLESS', true),
    respectRobots: bool('RESPECT_ROBOTS', true),
  },
  research: {
    // Force the plain-HTTP fetch crawler even when Chromium is available
    // (useful in locked-down/serverless environments).
    forceFetchFallback: bool('FORCE_FETCH_FALLBACK', false),
    // Max pages for the fetch fallback crawler. Raised to cover the expanded
    // page set (giving/sermons/groups/locations/jobs) so optional categories are
    // actually investigated rather than inferred from a homepage link.
    fetchMaxPages: num('FETCH_MAX_PAGES', 12),
  },
  search: {
    // Optional API-keyed search backends. When a key is present the provider is
    // slotted AHEAD of the HTML scrapers (which return 0 results in many hosted
    // environments) — this is what lets reported-attendance lookups actually
    // activate. No key → the scrapers remain the keyless fallback.
    serperApiKey: process.env.SERPER_API_KEY ?? '',
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY ?? '',
  },
  prospect: {
    // Google Places API key for area enumeration (prospect-area command).
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',
    // Max churches fully dossiered per area run (cost bound).
    maxDossiers: num('PROSPECT_MAX_DOSSIERS', 25),
  },
  thresholds: {
    autoUpdate: num('AUTO_UPDATE_THRESHOLD', 85),
    review: num('REVIEW_THRESHOLD', 60),
  },
  dashboard: {
    port: num('DASHBOARD_PORT', 4000),
  },
  api: {
    // Shared secret Base44 must present as `Authorization: Bearer <CIP_API_KEY>`.
    // The backend owns every other secret (Anthropic, Supabase, Places); Base44
    // only ever holds this one bearer token.
    cipApiKey: process.env.CIP_API_KEY ?? '',
    port: num('CIP_API_PORT', 4100),
  },
};

export type AppConfig = typeof config;

export function assertSupabaseConfigured() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env',
    );
  }
}
export function assertClaudeConfigured() {
  if (!config.claude.apiKey) {
    throw new Error('Claude is not configured. Set ANTHROPIC_API_KEY in .env');
  }
}
