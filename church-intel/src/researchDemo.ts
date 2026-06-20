/**
 * Offline Research-Agent mechanism proof (no network / no credentials).
 *
 * ⚠️ PROVENANCE — READ BEFORE TRUSTING ANY VALUE HERE:
 * This file is SYNTHETIC test scaffolding. It exercises code paths (snippet-only
 * access, confidence capping, role-conflict preservation, contamination
 * detection) WITHOUT any real research. The tool has never fetched
 * cornerstonechurch.info in this environment (egress is blocked).
 *
 * Only these Cornerstone values are real, and only because the USER provided
 * them: church name "Cornerstone Church" (Akron, OH), the website URL, lead
 * pastor "Jacob Young", office email Connect@CornerstoneChurch.info, office
 * phone (330) 644-3937. Everything else (the conflicting role claim, the
 * same-name decoy, the mock synthesis scores/lifecycle) is SYNTHETIC fixture
 * data and is labelled as such. No value here was discovered by the tool.
 *
 *   npm run research-demo
 */
import { MockLlmProvider, type ExtractOptions } from './claude/client.js';
import { ResilientResearch } from './research/resilient.js';
import { buildDossier, type ResearchTarget } from './research/researchAgent.js';
import { renderDossierMarkdown } from './research/dossierMarkdown.js';
import type { DossierSynthesis } from './claude/dossierPrompt.js';

// ── mocked search + pages ───────────────────────────────────────────────────
const RESULTS: { url: string; title: string; snippet: string }[] = [
  // USER-PROVIDED facts (relayed by the user; not tool-discovered):
  { url: 'https://www.cornerstonechurch.info/staff', title: 'Our Staff — Cornerstone Church', snippet: 'Jacob Young is the Lead Pastor. Email Connect@CornerstoneChurch.info or call (330) 644-3937.' },
  { url: 'https://www.cornerstonechurch.info/contact', title: 'Contact — Cornerstone Church', snippet: 'Contact Cornerstone Church, Akron OH. Connect@CornerstoneChurch.info (330) 644-3937.' },
  // SYNTHETIC fixture — a conflicting role claim, to exercise conflict preservation.
  // Not a real profile; the host and content are placeholders.
  { url: 'https://synthetic-profile.example/fixture', title: '(SYNTHETIC fixture) role-conflict source', snippet: 'SYNTHETIC fixture only: Associate Pastor at the church. Used to test that a role conflict (Lead vs Associate) is preserved, not silently resolved.' },
  // SYNTHETIC decoy — a DIFFERENT, same-name church in another state, to exercise
  // contamination detection. Not a real church; all specifics are placeholders.
  { url: 'https://synthetic-samename-church.example/', title: 'Cornerstone Church | Faraway, TX (SYNTHETIC decoy)', snippet: 'SYNTHETIC decoy only: a different Cornerstone Church located in Faraway, TX.' },
];

const PAD = ' We gather every week for worship and to follow Jesus together as a church family. Sundays bring teaching, prayer, and community for all ages.';
const PAGES: Record<string, { status: number; html: string }> = {
  // Official site blocks the crawler here (sandbox/bot block) → DOM never fetched,
  // so the dossier is correctly snippet-only and confidence is capped.
  'cornerstonechurch.info': { status: 403, html: 'Forbidden' },
  // SYNTHETIC same-name decoy in a DIFFERENT state — should be flagged as
  // contamination (a same-name church elsewhere), never attributed to this church.
  'synthetic-samename-church.example': {
    status: 200,
    html: `<title>Cornerstone Church | Faraway, TX</title><h1>Cornerstone Church</h1><p>A church in Faraway, TX.${PAD}</p>`,
  },
};

function ddgHtml(results: { url: string; title: string; snippet: string }[]): string {
  return results.map((r) => `result__body<a class="result__a" href="${r.url}">${r.title}</a><a class="result__snippet">${r.snippet}</a>`).join('\n');
}

const SEARCH_HOSTS = ['html.duckduckgo.com', 'lite.duckduckgo.com', 'www.bing.com', 'www.mojeek.com'];

/** Build the Cornerstone dossier fully offline (mocked fetch + mock Claude). */
export async function buildCornerstoneOffline() {
  installMockFetch();
  const target: ResearchTarget = {
    name: 'Cornerstone Church', city: 'Akron', state: 'OH',
    originalWebsite: 'https://www.cornerstonechurch.info', alternateName: null,
  };
  const research = new ResilientResearch();
  const build = await buildDossier(target, { llm: new MockLlmProvider(synthesize), research });
  await research.close();
  return { target, build };
}

export function installMockFetch() {
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const h = new URL(url).hostname;
    if (SEARCH_HOSTS.includes(h)) return new Response(ddgHtml(RESULTS), { status: 200, headers: { 'content-type': 'text/html' } });
    const page = PAGES[h] || PAGES[h.replace(/^www\./, '')];
    if (page) return new Response(page.html, { status: page.status, headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

// ── mocked Claude synthesis ─────────────────────────────────────────────────
/**
 * SYNTHETIC mock synthesis. The only church-specific value asserted by tests is
 * lead_pastor ("Jacob Young", user-provided) and lifecycle_stage (a synthetic
 * mock label used to exercise the archetype mapping). Size/attendance/social
 * specifics are deliberately null — this fixture never discovered them.
 */
export function synthesize(_opts: ExtractOptions<unknown>): DossierSynthesis {
  return {
    identity_summary: 'Cornerstone Church, Akron OH (cornerstonechurch.info). [SYNTHETIC mock synthesis — offline fixture; no real research performed.]',
    digital_summary: '[SYNTHETIC mock] Digital footprint not assessed in this offline fixture.',
    staff_summary: 'Lead pastor Jacob Young (user-provided). [SYNTHETIC mock] A conflicting "Associate Pastor" claim is preserved as a conflict, not resolved.',
    growth_summary: '[SYNTHETIC mock] Lifecycle label set to revitalization to exercise archetype mapping.',
    lifecycle_summary: '[SYNTHETIC mock] relaunch/revitalization (fixture label, not a discovered fact).',
    research_summary: 'Official DOM not fetched (403); snippet-only. [SYNTHETIC mock] Confidence capped accordingly.',
    lifecycle_stage: 'relaunch_revitalization',
    growth_orientation_score: 55,
    digital_maturity_score: 50,
    change_readiness_score: 70,
    staff_depth_score: 40,
    church_app_status: 'unknown',
    app_provider: null,
    lead_pastor: 'Jacob Young',
    denomination: null,
    online_attendance_estimate: null,
    online_attendance_confidence: 0,
    attendance_estimate: null,
    attendance_min: null,
    attendance_max: null,
    attendance_confidence: 0,
    staff_count: null,
    staff_count_confidence: 0,
    campus_count: null,
    campus_count_confidence: 0,
    fields: [
      { field_name: 'lead_pastor', value: 'Jacob Young', confidence: 65, evidence: 'user-provided; staff snippet', access_level: 'search_snippets' },
    ],
    known: ['Lead pastor Jacob Young (user-provided)', 'Office email/phone (user-provided)'],
    uncertain: ['Most facts unverified — official DOM not fetched in this offline fixture', 'Size, denomination, social, founding date: not collected'],
  };
}

async function main() {
  const { target, build } = await buildCornerstoneOffline();
  console.log(renderDossierMarkdown(target, build));

  console.log('\n=== MECHANISM ASSERTIONS (synthetic fixture) ===');
  const check = (label: string, pass: boolean, detail: string) =>
    console.log(`  ${pass ? '✓' : '✗'} ${label}: ${detail}`);
  check('official DOM not fetched', build.officialCrawled === false, `officialCrawled=${build.officialCrawled}`);
  check('access level capped to snippets', build.accessLevel === 'search_snippets', `accessLevel=${build.accessLevel}`);
  const lead = build.fieldEstimates.find((f) => f.field_name === 'lead_pastor');
  check('field confidence capped at 65', !!lead && lead.confidence <= 65, `lead_pastor confidence=${lead?.confidence}`);
  const conflict = build.conflicts.find((c) => c.field_name === 'lead_pastor_role');
  check('Lead/Associate conflict preserved', !!conflict, conflict ? `${conflict.value_a} vs ${conflict.value_b} → ${conflict.recommended_value}` : 'none');
  check('contamination flagged (synthetic same-name decoy)', build.contamination.length > 0, `${build.contamination.length} flag(s)`);
  check('research_confidence capped', (build.dossier.research_confidence ?? 100) <= 65, `research_confidence=${build.dossier.research_confidence}`);
}

if (process.argv[1] && /researchDemo\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
