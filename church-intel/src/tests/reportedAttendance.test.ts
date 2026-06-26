/**
 * Authoritative reported-attendance source (Outreach 100 / Hartford). A published
 * figure is a REPORTED number that overrides the staff-pattern inference which
 * under-sizes megachurches (Grace, Cross Point). Parser is tested offline; the
 * interpret integration proves it flows as source=reported with provenance.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { parseAuthoritativeAttendance, lookupReportedAttendance } from '../research/reportedAttendanceSource.js';
import { interpretDossier } from '../research/interpret.js';
import { emptyNormalizedEvidence } from '../research/evidenceModel.js';
import type { SearchResult } from '../research/types.js';
import type { DossierSynthesis } from '../claude/dossierPrompt.js';
import type { Facts } from '../research/extractors.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}
const sr = (title: string, url: string, snippet: string): SearchResult => ({ title, url, snippet });

function synth(over: Partial<DossierSynthesis> = {}): DossierSynthesis {
  return {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'established', growth_orientation_score: 50, digital_maturity_score: 50, change_readiness_score: 50, staff_depth_score: 50,
    church_app_status: 'none', app_provider: null, lead_pastor: null, denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: null, attendance_min: null, attendance_max: null,
    attendance_confidence: 0, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [], ...over,
  } as DossierSynthesis;
}

async function main() {
  console.log('Authoritative reported attendance — Outreach 100 / Hartford');

  // ── parser ──────────────────────────────────────────────────────────────────
  const grace = sr('Outreach 100: Grace Church', 'https://outreach100.com/churches/grace-church-1', 'Grace Church — #58 Largest Churches 2020 — average attendance of 5,372.');
  check('Outreach 100 page → 5,372, rank 58, year 2020', () => {
    const r = parseAuthoritativeAttendance([grace], 'Grace Church');
    assert.ok(r); assert.strictEqual(r!.value, 5372); assert.strictEqual(r!.source, 'Outreach 100');
    assert.strictEqual(r!.rank, 58); assert.strictEqual(r!.year, 2020);
    assert.match(r!.evidence, /Outreach 100 #58 \(2020\): 5,372/);
  });
  check('Hartford DB result → source = Hartford', () => {
    const h = sr('Megachurch Database', 'https://hirr.hartfordinternational.edu/megachurch/x', 'Cross Point Church weekly attendance 5,000.');
    const r = parseAuthoritativeAttendance([h], 'Cross Point Church');
    assert.ok(r); assert.strictEqual(r!.value, 5000); assert.match(r!.source, /Hartford/);
  });
  check('wrong-church guard: a different church on an Outreach page is ignored', () => {
    const other = sr('Outreach 100', 'https://outreach100.com/churches/first-baptist', 'First Baptist Dallas — average attendance of 12,000.');
    assert.strictEqual(parseAuthoritativeAttendance([other], 'Grace Church'), null);
  });
  check('non-authoritative result (random blog) is ignored', () => {
    const blog = sr('Grace Church blog', 'https://randomblog.com/grace', 'Grace Church has an average attendance of 5,372.');
    assert.strictEqual(parseAuthoritativeAttendance([blog], 'Grace Church'), null);
  });
  check('prefers the largest credible figure across sources', () => {
    const small = sr('Outreach', 'https://outreach100.com/grace', 'Grace Church Bath campus attendance 1,200.');
    const big = sr('Outreach', 'https://outreach100.com/grace', 'Grace Church total weekly attendance 5,372.');
    assert.strictEqual(parseAuthoritativeAttendance([small, big], 'Grace Church')!.value, 5372);
  });

  // ── lookup (mock search) ────────────────────────────────────────────────────
  check('lookupReportedAttendance runs queries + parses', async () => {
    const search = async () => ({ results: [grace] });
    const r = await lookupReportedAttendance('Grace Church', 'OH', search);
    assert.ok(r); assert.strictEqual(r!.value, 5372);
  });
  // (await the async check above)
  await lookupReportedAttendance('Grace Church', 'OH', async () => ({ results: [grace] }));

  // ── interpret integration: reported figure overrides pattern, with provenance ─
  check('reported figure → interpretation attendance = reported, with source in evidence', () => {
    const facts: Facts = {
      reported_attendance: { value: 5372, confidence: 82, evidence: 'Outreach 100 #58 (2020): 5,372 reported attendance', source_url: 'https://outreach100.com/churches/grace-church-1', access_level: 'third_party_directory' },
      staff_count: { value: 7, confidence: 70, evidence: '7 staff', source_url: 'x', access_level: 'live_official_site' }, // pattern would say ~850
    };
    const interp = interpretDossier({ normalized: emptyNormalizedEvidence(), synthesis: synth(), facts, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
    assert.strictEqual(interp.attendance_estimate.value, 5372);
    assert.strictEqual(interp.attendance_source, 'reported');
    assert.match(interp.attendance_reasoning, /Reported 5372/);
    assert.ok(interp.attendance_evidence.some((a) => /Outreach 100/.test(a.detail)), 'source not surfaced in evidence');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
