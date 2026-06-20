/**
 * Offline Research-Agent calibration proof (no network / no credentials).
 *
 * Reproduces the Cornerstone Church (Akron) case with a mocked `fetch`:
 *   - the official site (cornerstonechurch.info) returns 403 → DOM never fetched
 *   - evidence is reconstructed from search snippets + third-party sources
 *   - a Lead-vs-Associate pastor conflict is preserved
 *   - a same-name contamination flag (Cornerstone Ames, IA) is raised
 *   - confidence is CAPPED at the search-snippets ceiling (65)
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
  { url: 'https://www.cornerstonechurch.info/staff', title: 'Our Staff — Cornerstone Church', snippet: 'Jacob Young is the Lead Pastor at Cornerstone since the relaunch in August 2020. Our staff team of 6. Email Connect@CornerstoneChurch.info or call (330) 644-3937. 2445 S Arlington Rd, Akron, OH.' },
  { url: 'https://www.cornerstonechurch.info/our-history', title: 'Our History — Cornerstone Church', snippet: 'We began in 1980 with about 75 people. In 2020 Cornerstone Church celebrated 40 years and relaunched into a new season.' },
  { url: 'https://www.cornerstonechurch.info/contact', title: 'Contact — Cornerstone Church', snippet: 'Cornerstone Church is one location at 2445 S Arlington Rd, Akron OH 44319. Sundays 9 & 11 AM. Give online. (330) 644-3937. Connect@CornerstoneChurch.info' },
  { url: 'https://www.linkedin.com/in/jcbyng', title: 'Jacob Young - Associate Pastor - Cornerstone Church', snippet: 'Associate Pastor at Cornerstone Church. Akron, Ohio.' },
  { url: 'https://www.instagram.com/cornerstonechurchsocial/', title: 'Cornerstone Church (@cornerstonechurchsocial) · Akron, OH', snippet: '1,098 followers. A place for people curious about Jesus but cautious about church.' },
  { url: 'https://www.facebook.com/CornerstoneChurchSocialPLX/', title: 'Cornerstone Church | Akron OH | Facebook', snippet: '1K followers. Sunday 9 & 11 AM.' },
  { url: 'https://www.youtube.com/channel/UCa74GpTNBGUbw1eSIhX0GYQ', title: 'Cornerstone Church - YouTube', snippet: 'Join us live Sundays 9 & 11 AM.' },
  { url: 'https://ministryjobs.com/job/next-gen-directorpastor-full-time-akron-oh/', title: 'Next Gen Director/Pastor — Cornerstone Church, Akron OH', snippet: 'Cornerstone Church is hiring a Next Gen Director.' },
  { url: 'https://cornerstonelife.com/sending/', title: 'Sending – Cornerstone Church', snippet: 'Cornerstone Church in Ames, IA sends planters through the Salt Network.' },
];

const PAGES: Record<string, { status: number; html: string }> = {
  // official site blocks the crawler (as it did for real)
  'cornerstonechurch.info': { status: 403, html: 'Forbidden' },
  // a DIFFERENT same-name church (Ames, IA) — should be flagged as contamination
  'cornerstonelife.com': {
    status: 200,
    html: `<title>Cornerstone Church | Ames, IA</title><nav><a href="/give">Give</a><a href="/sermons">Sermons</a><a href="/visit">Plan a Visit</a><a href="/ministries">Ministries</a></nav><h1>Cornerstone Church</h1><p>We are a church in Ames, IA. Service times Sunday. Plan your visit. The Salt Network. We gather each week for worship, teaching, prayer, and community across our campuses, sending planters and missionaries throughout the Midwest and around the world as we make disciples who make disciples for the glory of God in our city.</p>`,
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
export function synthesize(_opts: ExtractOptions<unknown>): DossierSynthesis {
  return {
    identity_summary: 'Cornerstone Church, Akron OH (cornerstonechurch.info). Non-denominational, single site at 2445 S Arlington Rd. Founded ~1980; relaunched Aug 2020 under Jacob Young.',
    digital_summary: 'Website + YouTube livestream + Instagram (~1,098) + Facebook (~1K) + newsletter. No app found; giving/ChMS provider unknown.',
    staff_summary: 'Jacob Young leads (title conflict: site says Lead Pastor, LinkedIn says Associate). Hiring a Next Gen Director.',
    growth_summary: 'Revitalizing post-2020; modern rebrand; small but active footprint.',
    lifecycle_summary: '40-year-old church that relaunched in 2020 — a revitalization.',
    research_summary: 'Official DOM not fetched (403); profile reconstructed from snippets + social + job posting. Confidence capped.',
    lifecycle_stage: 'relaunch_revitalization',
    growth_orientation_score: 55,
    digital_maturity_score: 50,
    change_readiness_score: 70,
    staff_depth_score: 40,
    church_app_status: 'none_found',
    app_provider: null,
    lead_pastor: 'Jacob Young',
    denomination: 'Non-denominational',
    online_attendance_estimate: 120,
    online_attendance_confidence: 70,
    attendance_estimate: 300,
    attendance_min: 150,
    attendance_max: 500,
    attendance_confidence: 80,
    fields: [
      { field_name: 'lead_pastor', value: 'Jacob Young', confidence: 85, evidence: 'staff page snippet', access_level: 'search_snippets' },
      { field_name: 'lifecycle_stage', value: 'relaunch_revitalization', confidence: 80, evidence: 'celebrated 40 years in 2020; relaunch Aug 2020' },
      { field_name: 'instagram_followers', value: '1,098', confidence: 60, evidence: 'Instagram snippet' },
    ],
    known: ['Founded ~1980; relaunched Aug 2020 under Jacob Young', 'Single site, 2445 S Arlington Rd, Akron OH', 'Livestream + YouTube + IG/FB present'],
    uncertain: ['Exact weekly attendance and budget', 'Giving/ChMS/app provider', 'Jacob Young title: Lead vs Associate (conflict)'],
  };
}

async function main() {
  const { target, build } = await buildCornerstoneOffline();
  console.log(renderDossierMarkdown(target, build));

  console.log('\n=== CALIBRATION ASSERTIONS ===');
  const check = (label: string, pass: boolean, detail: string) =>
    console.log(`  ${pass ? '✓' : '✗'} ${label}: ${detail}`);
  check('official DOM not fetched', build.officialCrawled === false, `officialCrawled=${build.officialCrawled}`);
  check('access level capped to snippets', build.accessLevel === 'search_snippets', `accessLevel=${build.accessLevel}`);
  const lead = build.fieldEstimates.find((f) => f.field_name === 'lead_pastor');
  check('field confidence capped at 65', !!lead && lead.confidence <= 65, `lead_pastor confidence=${lead?.confidence}`);
  const conflict = build.conflicts.find((c) => c.field_name === 'lead_pastor_role');
  check('Lead/Associate conflict preserved', !!conflict, conflict ? `${conflict.value_a} vs ${conflict.value_b} → ${conflict.recommended_value}` : 'none');
  check('contamination flagged (Ames)', build.contamination.some((c) => /ames|cornerstonelife/i.test(c)), `${build.contamination.length} flag(s)`);
  check('research_confidence capped', (build.dossier.research_confidence ?? 100) <= 65, `research_confidence=${build.dossier.research_confidence}`);
}

if (process.argv[1] && /researchDemo\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
