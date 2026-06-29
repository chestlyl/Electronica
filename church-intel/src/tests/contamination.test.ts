/**
 * Contamination ENFORCEMENT (One City Church Nashville regression).
 *
 * Same-name churches in a different city/state are DETECTED by discovery but were
 * never enforced, so wrong-church contacts (Randy Feldschau, Becky Fouquier, the
 * Beaumont 409 phone) leaked into Leadership Access / Contact Intelligence /
 * Outreach Intelligence. This proves enforcement removes them from all three,
 * keeps the real church's people, and does NOT change scores.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { computeContaminationSources, enforceContamination, filterContaminatedFindings, isContaminatedUrl, type ContaminationSources } from '../research/contamination.js';
import { buildContactIntel } from '../research/contactIntel.js';
import { buildOutreachIntel } from '../research/outreachIntel.js';
import type { NormalizedRow } from '../research/evidenceModel.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const BAD_HOST = 'onecitybeaumont.org';
const BAD_URL = `https://${BAD_HOST}/staff`;
const row = (o: Partial<NormalizedRow> & { value: string; category: string; source_url: string }): NormalizedRow => ({
  id: `x_${Math.round(o.confidence ?? 0)}_${o.value}`, evidence_text: 'x', confidence: 70, access_level: 'search_snippets', extractor_name: 'test', ...o,
});

async function main() {
  console.log('Contamination enforcement (One City Church regression)');

  // ── detection → source set ──────────────────────────────────────────────────
  check('computeContaminationSources flags the different-city same-name host', () => {
    const identity = { candidates: [
      { nameFull: true, cityStatus: 'match', kind: 'official_church', source: 'search', host: 'theonecity.org', url: 'https://theonecity.org' },
      { nameFull: true, cityStatus: 'conflict', kind: 'official_church', source: 'search', host: BAD_HOST, url: BAD_URL },
    ] } as unknown as Parameters<typeof computeContaminationSources>[0];
    const s = computeContaminationSources(identity);
    assert.ok(s.hosts.has(BAD_HOST), 'contaminated host captured');
    assert.ok(!s.hosts.has('theonecity.org'), 'the real church host is NOT contaminated');
    assert.ok(s.flags.length === 1);
  });
  check('isContaminatedUrl matches by host, not the real site', () => {
    const s: ContaminationSources = { hosts: new Set([BAD_HOST]), urls: new Set([BAD_URL]), flags: [] };
    assert.ok(isContaminatedUrl(`https://${BAD_HOST}/contact`, s));
    assert.ok(!isContaminatedUrl('https://theonecity.org/staff', s));
  });

  // ── UPSTREAM filter: contaminated findings excluded BEFORE extraction ───────
  check('filterContaminatedFindings drops contaminated findings, keeps the real church', () => {
    const s: ContaminationSources = { hosts: new Set([BAD_HOST]), urls: new Set([BAD_URL]), flags: [] };
    const findings = [
      { url: 'https://theonecity.org/' }, { url: 'https://theonecity.org/staff' }, { url: BAD_URL },
    ];
    const { kept, removed } = filterContaminatedFindings(findings, s);
    assert.strictEqual(kept.length, 2);
    assert.strictEqual(removed.length, 1);
    assert.ok(kept.every((f) => f.url.includes('theonecity.org')));
  });
  check('filterContaminatedFindings is a no-op when nothing is contaminated', () => {
    const empty: ContaminationSources = { hosts: new Set(), urls: new Set(), flags: [] };
    const findings = [{ url: 'https://a.org' }, { url: 'https://b.org' }];
    const { kept, removed } = filterContaminatedFindings(findings, empty);
    assert.strictEqual(kept, findings, 'returns the same array reference (true no-op)');
    assert.strictEqual(removed.length, 0);
  });

  // ── enforcement on a REAL offline build with injected contamination ─────────
  const { build } = await buildCornerstoneOffline();

  // End-to-end upstream proof: the Cornerstone fixture injects a same-name decoy
  // ("Cornerstone Church | Faraway, TX"). It must be flagged AND already excluded
  // from `findings` before any extraction ran — so it never reached scoring.
  check('upstream: the same-name decoy is flagged AND excluded from findings before extraction', () => {
    assert.ok(build.contaminationSources.hosts.has('synthetic-samename-church.example'), 'decoy host flagged');
    assert.ok(!build.findings.some((f) => f.url.includes('synthetic-samename')), 'decoy excluded from findings');
  });

  const N = build.normalized, I = build.interpretation;
  const cleanLeadCount = N.leaders.length;
  const realLead = N.leaders[0]?.value;                                  // a genuine Cornerstone leader
  const scoresBefore = JSON.stringify(build.strategicScores);           // snapshot for score-neutrality

  // Inject the One City Nashville contamination (a different-city "One City Church").
  N.leaders.push(row({ value: 'Randy Feldschau', category: 'lead_pastor', detail: 'Lead Pastor', source_url: BAD_URL }));
  N.staff_roster.push(row({ value: 'Becky Fouquier', category: 'staff', detail: 'Administrator', source_url: BAD_URL }));
  N.email_map.push(row({ value: 'randy@onecitybeaumont.org', category: 'person', detail: 'Randy Feldschau', source_url: BAD_URL }));
  N.contacts.push(row({ value: '(409) 892-8475', category: 'phone', source_url: BAD_URL, confidence: 50 }));
  N.locations.push(row({ value: '123 Calder Ave, Beaumont, TX 77701', category: 'address', source_url: BAD_URL, confidence: 60 }));
  I.lead_pastors.value = [...I.lead_pastors.value, 'Randy Feldschau'];
  I.office_phone.value = '(409) 892-8475'; I.office_phone.evidence_ids = [];
  I.office_email.value = 'randy@onecitybeaumont.org'; I.office_email.evidence_ids = [];

  const sources: ContaminationSources = { hosts: new Set([BAD_HOST]), urls: new Set([BAD_URL]), flags: ['flag'] };
  const { removed } = enforceContamination(N, I, sources);

  check('removed the injected contaminated rows (leaders/roster/email/contact/location)', () => {
    assert.strictEqual(removed, 5, `expected 5 removed, got ${removed}`);
  });
  check('Leadership: contaminated leaders gone, the real church leader stays', () => {
    assert.ok(!N.leaders.some((l) => l.value === 'Randy Feldschau'), 'Randy removed from leaders');
    assert.ok(!N.staff_roster.some((r) => r.value === 'Becky Fouquier'), 'Becky removed from roster');
    assert.strictEqual(N.leaders.length, cleanLeadCount, 'real leaders intact');
    if (realLead) assert.ok(N.leaders.some((l) => l.value === realLead), 'genuine leader retained');
    assert.ok(!I.lead_pastors.value.includes('Randy Feldschau'), 'lead_pastors conclusion scrubbed');
  });
  check('single-value conclusions scrubbed (contaminated office phone + email)', () => {
    assert.strictEqual(I.office_phone.value, null, 'contaminated phone scrubbed');
    assert.strictEqual(I.office_email.value, null, 'contaminated email scrubbed');
  });

  // ── Contact Intelligence section is clean ───────────────────────────────────
  const ci = buildContactIntel({ findings: build.findings, normalized: N, interpretation: I, contaminatedHosts: sources.hosts });
  check('Contact Intelligence: no contaminated email in any bucket', () => {
    const allEmails = [...ci.church_emails, ...ci.role_emails, ...ci.person_emails, ...ci.unassigned_emails].map((e) => e.value);
    assert.ok(!allEmails.includes('randy@onecitybeaumont.org'), 'contaminated email absent');
  });
  check('Contact Intelligence: the Beaumont 409 phone is gone', () => {
    assert.ok(!ci.phones.some((p) => p.value.replace(/\D/g, '') === '4098928475'), '409 phone absent');
  });

  // ── Outreach Intelligence section is clean ──────────────────────────────────
  const oi = buildOutreachIntel({ interpretation: I, normalized: N, scores: build.strategicScores, recommendations: build.recommendations, sizeRelative: build.sizeRelative });
  check('Outreach Intelligence: best/fallback contact is never a contaminated person', () => {
    for (const c of [oi.best_first_contact, oi.fallback_contact]) {
      if (c) assert.ok(c.name !== 'Randy Feldschau' && c.name !== 'Becky Fouquier', `contaminated contact surfaced: ${c.name}`);
    }
  });

  // ── score-neutrality: enforcement must NOT change scores ─────────────────────
  check('scores are unchanged by contamination enforcement', () => {
    assert.strictEqual(JSON.stringify(build.strategicScores), scoresBefore, 'strategic scores moved');
  });

  // ── no contamination → no-op ────────────────────────────────────────────────
  check('empty source set → enforcement is a no-op', () => {
    const { build: b2 } = { build } as { build: typeof build }; void b2;
    const before = b2.normalized.leaders.length;
    const r = enforceContamination(b2.normalized, b2.interpretation, { hosts: new Set(), urls: new Set(), flags: [] });
    assert.strictEqual(r.removed, 0);
    assert.strictEqual(b2.normalized.leaders.length, before);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
