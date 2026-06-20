import { config } from './config.js';
import { chromiumInstalled } from './research/browser.js';
import { multiSearch } from './research/searchProviders.js';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const SAMPLE_CHURCH_URL = process.env.DOCTOR_SAMPLE_URL || 'https://www.life.church';
const ANTHROPIC_HOST = config.claude.baseUrl || 'https://api.anthropic.com';

interface Probe {
  reachable: boolean;
  status: number;
  blocked: boolean;
  error?: string;
}

/** Returns whether an HTTP response came back, and whether an egress allowlist blocked it. */
async function probe(url: string): Promise<Probe> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': config.crawl.userAgent, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    let blocked = false;
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      blocked = /not in allowlist|egress|forbidden host/i.test(body);
    }
    return { reachable: true, status: res.status, blocked };
  } catch (err) {
    return { reachable: false, status: 0, blocked: false, error: (err as Error).message };
  }
}

export async function runDoctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const has = (v: string) => v.trim().length > 0;

  // 1–3: credentials present
  checks.push(
    has(config.claude.apiKey)
      ? { name: 'Anthropic API key', status: 'PASS', detail: 'ANTHROPIC_API_KEY is set' }
      : { name: 'Anthropic API key', status: 'FAIL', detail: 'ANTHROPIC_API_KEY is missing', fix: 'Add ANTHROPIC_API_KEY=sk-ant-... to .env' },
  );
  const haveUrl = has(config.supabase.url);
  const haveKey = has(config.supabase.serviceRoleKey);
  checks.push(
    haveUrl
      ? { name: 'Supabase URL', status: 'PASS', detail: config.supabase.url }
      : { name: 'Supabase URL', status: 'FAIL', detail: 'SUPABASE_URL is missing', fix: 'Add SUPABASE_URL=https://<ref>.supabase.co to .env' },
  );
  checks.push(
    haveKey
      ? { name: 'Supabase service role key', status: 'PASS', detail: 'SUPABASE_SERVICE_ROLE_KEY is set' }
      : { name: 'Supabase service role key', status: 'FAIL', detail: 'SUPABASE_SERVICE_ROLE_KEY is missing', fix: 'Copy the service_role key from Supabase → Project Settings → API' },
  );

  // 4–5: DB connection + migration applied (one query, two conclusions)
  if (haveUrl && haveKey) {
    let connOk = false;
    let tableOk = false;
    let errMsg = '';
    try {
      const { supabase } = await import('./db/supabase.js');
      const { error } = await supabase()
        .from('churches')
        .select('id', { count: 'exact', head: true });
      if (!error) {
        connOk = true;
        tableOk = true;
      } else {
        errMsg = error.message;
        // Reaching Postgres and getting a "relation does not exist" still proves
        // the connection works — it just means the migration hasn't been run.
        if (/relation .* does not exist|could not find the table|schema cache/i.test(error.message)) {
          connOk = true;
          tableOk = false;
        }
      }
    } catch (e) {
      errMsg = (e as Error).message;
    }
    checks.push(
      connOk
        ? { name: 'Database connection', status: 'PASS', detail: 'Connected to Supabase Postgres' }
        : { name: 'Database connection', status: 'FAIL', detail: errMsg || 'could not connect', fix: 'Verify SUPABASE_URL/key and network access to the Supabase host' },
    );
    checks.push(
      tableOk
        ? { name: 'Migration applied', status: 'PASS', detail: '`churches` table exists' }
        : connOk
          ? { name: 'Migration applied', status: 'FAIL', detail: '`churches` table not found', fix: 'Run supabase/migrations/0001_initial_schema.sql (supabase db push, or paste into the SQL editor)' }
          : { name: 'Migration applied', status: 'SKIP', detail: 'skipped — no DB connection' },
    );
  } else {
    checks.push({ name: 'Database connection', status: 'SKIP', detail: 'skipped — Supabase not configured', fix: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' });
    checks.push({ name: 'Migration applied', status: 'SKIP', detail: 'skipped — Supabase not configured' });
  }

  // 6: Playwright Chromium installed
  const chromium = chromiumInstalled();
  checks.push(
    chromium
      ? { name: 'Playwright Chromium', status: 'PASS', detail: 'Chromium browser is installed' }
      : { name: 'Playwright Chromium', status: 'WARN', detail: 'Chromium not installed — will use the fetch fallback (no JS rendering)', fix: 'Run `npx playwright install chromium` for full JS-rendered crawling' },
  );

  // 7: outbound HTTP (to the Anthropic host)
  const out = await probe(ANTHROPIC_HOST);
  checks.push(
    out.reachable && !out.blocked
      ? { name: 'Outbound HTTP', status: 'PASS', detail: `reached ${ANTHROPIC_HOST} (status ${out.status})` }
      : out.blocked
        ? { name: 'Outbound HTTP', status: 'FAIL', detail: `egress allowlist blocked ${ANTHROPIC_HOST}`, fix: `Allowlist ${new URL(ANTHROPIC_HOST).host} (and api.anthropic.com) in your network egress settings` }
        : { name: 'Outbound HTTP', status: 'FAIL', detail: out.error || 'no response', fix: 'Check container/network egress; outbound HTTPS is required' },
  );

  // 8: search — exercise the real multi-provider search layer
  const { results, diagnostics } = await multiSearch('First Baptist Church Dallas TX', { limit: 5, minHosts: 99 });
  const working = diagnostics.filter((d) => d.ok);
  const reachable = diagnostics.filter((d) => d.status > 0);
  const summary = diagnostics.map((d) => `${d.provider}=${d.status}/${d.resultCount}`).join('  ');
  if (results.length > 0) {
    checks.push({ name: 'Search providers', status: 'PASS', detail: `${working.length}/${diagnostics.length} engines returned results — ${summary}` });
  } else if (reachable.length > 0) {
    checks.push({ name: 'Search providers', status: 'WARN', detail: `engines reachable but returned 0 results (challenge/rate-limit) — ${summary}`, fix: 'Search is degraded; discovery will lean on seed websites + domain guesses. Retry later or run from a residential IP.' });
  } else {
    checks.push({ name: 'Search providers', status: 'FAIL', detail: `no search engine reachable — ${summary}`, fix: 'Allowlist html.duckduckgo.com, lite.duckduckgo.com, www.bing.com, www.mojeek.com (or open outbound egress).' });
  }

  // 9: sample church website fetch
  const site = await probe(SAMPLE_CHURCH_URL);
  checks.push(
    site.reachable && !site.blocked
      ? { name: 'Church website fetch', status: 'PASS', detail: `fetched ${SAMPLE_CHURCH_URL} (status ${site.status})` }
      : site.blocked
        ? { name: 'Church website fetch', status: 'FAIL', detail: `egress allowlist blocked ${SAMPLE_CHURCH_URL}`, fix: 'Open outbound egress (or allowlist church domains). Crawling arbitrary church sites is required for real enrichment.' }
        : { name: 'Church website fetch', status: 'FAIL', detail: site.error || 'no response', fix: 'Verify outbound HTTPS to arbitrary hosts is permitted' },
  );

  // 10: real providers vs. mock
  const realReady = has(config.claude.apiKey) && haveUrl && haveKey;
  const researchMode = config.research.forceFetchFallback
    ? 'fetch_fallback (forced)'
    : chromium
      ? 'playwright'
      : 'fetch_fallback (Chromium not installed)';
  checks.push(
    realReady
      ? { name: 'Real providers (not mock)', status: 'PASS', detail: `live Claude + Supabase + research (mode: ${researchMode}). The offline demo mocks are only used by \`npm run demo\`.` }
      : { name: 'Real providers (not mock)', status: 'FAIL', detail: 'missing credentials — CLI cannot run with real providers', fix: 'Provide ANTHROPIC_API_KEY + Supabase credentials. Until then, only `npm run demo` (mock providers) will run.' },
  );

  return checks;
}

const ICON: Record<Status, string> = { PASS: '✓ PASS', WARN: '! WARN', FAIL: '✗ FAIL', SKIP: '· SKIP' };

export function printDoctor(checks: Check[]): boolean {
  console.log('\nChurch Intelligence — environment doctor\n');
  for (const c of checks) {
    console.log(`  [${ICON[c.status].padEnd(6)}] ${c.name.padEnd(28)} ${c.detail}`);
    if (c.fix && (c.status === 'FAIL' || c.status === 'WARN')) {
      console.log(`              ↳ fix: ${c.fix}`);
    }
  }
  const count = (s: Status) => checks.filter((c) => c.status === s).length;
  console.log(
    `\n  Summary: ${count('PASS')} pass, ${count('WARN')} warn, ${count('FAIL')} fail, ${count('SKIP')} skip`,
  );
  const ready = count('FAIL') === 0;
  if (ready) {
    console.log('  Result: READY for real enrichment. Try: npm run cli -- enrich-church --id row-2\n');
  } else {
    console.log('  Result: NOT READY for real enrichment — resolve the FAIL items above.\n');
  }
  return ready;
}
