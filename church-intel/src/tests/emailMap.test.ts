/**
 * Stage 2 — Email map. Every email is collected, bucketed (person/role/church/
 * unassigned), and associated to a staff member when possible. Critically:
 * NOTHING is discarded — a personal webmail that is (correctly) refused as the
 * office email is still preserved in the map as "unassigned".
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { collectEmails, classifyEmail, buildEmailMap, type EmailRecord } from '../research/emailMap.js';
import { roleFromTitle, extractStaffCards } from '../research/staffCards.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership } from '../research/extractors.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals } from '../research/strategicSignals.js';
import { normalizeEvidence } from '../research/normalize.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const rec = (email: string, near = ''): EmailRecord => ({ email, source_url: 'https://grace.org/staff', access_level: 'live_official_site', near });
const STAFF = ['Jeff Bogue', 'Morgan Diaz'];
const DOMAIN = 'grace.org';

async function main() {
  console.log('Stage 2 — Email map (bucketing + person association)');

  // ── classification buckets ──────────────────────────────────────────────────
  check('person: jeff.bogue@grace.org → person (matched, on-domain)', () => {
    const c = classifyEmail(rec('jeff.bogue@grace.org'), STAFF, DOMAIN);
    assert.strictEqual(c.bucket, 'person'); assert.strictEqual(c.person, 'Jeff Bogue');
  });
  check('person via local-part flast: jbogue@grace.org → Jeff Bogue', () => {
    assert.strictEqual(classifyEmail(rec('jbogue@grace.org'), STAFF, DOMAIN).person, 'Jeff Bogue');
  });
  check('person via adjacency: morgan@grace.org near "Morgan Diaz" → Morgan Diaz', () => {
    const c = classifyEmail(rec('morgan@grace.org', 'Morgan Diaz, Executive Pastor — morgan@grace.org'), STAFF, DOMAIN);
    assert.strictEqual(c.bucket, 'person'); assert.strictEqual(c.person, 'Morgan Diaz');
  });
  check('role: giving@grace.org → role (hint giving)', () => {
    const c = classifyEmail(rec('giving@grace.org'), STAFF, DOMAIN);
    assert.strictEqual(c.bucket, 'role'); assert.match(c.role_hint ?? '', /giving/);
  });
  check('role: missions@grace.org → role', () => assert.strictEqual(classifyEmail(rec('missions@grace.org'), STAFF, DOMAIN).bucket, 'role'));
  check('church: info@grace.org → church', () => assert.strictEqual(classifyEmail(rec('info@grace.org'), STAFF, DOMAIN).bucket, 'church'));
  check('church: office@grace.org → church', () => assert.strictEqual(classifyEmail(rec('office@grace.org'), STAFF, DOMAIN).bucket, 'church'));

  // ── nothing dropped: personal webmail preserved as unassigned ───────────────
  check('unassigned: personal gmail preserved (NOT dropped)', () => {
    const c = classifyEmail(rec('sebastianw3965@gmail.com'), STAFF, DOMAIN);
    assert.strictEqual(c.bucket, 'unassigned'); assert.match(c.role_hint ?? '', /personal/);
  });
  check('unassigned: unknown same-domain mailbox preserved + flagged church-domain', () => {
    const c = classifyEmail(rec('randomperson@grace.org'), STAFF, DOMAIN);
    assert.strictEqual(c.bucket, 'unassigned'); assert.match(c.role_hint ?? '', /church domain/);
  });

  // ── collection: text + mailto, dedupe, keep highest access ──────────────────
  check('collectEmails pulls from visible text AND mailto fields, deduped', () => {
    const f1: SourceFinding = makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://grace.org/staff', fetched: true, status: 200, category: 'staff', text: 'Reach Jeff at jeff.bogue@grace.org or info@grace.org.' });
    const f2: SourceFinding = makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://grace.org/contact', fetched: true, status: 200, category: 'contact', text: 'Contact us', fields: [{ field_name: 'email', value: 'office@grace.org', confidence: 88, evidence_text: 'mailto', source_url: 'https://grace.org/contact', source_type: 'official_site', access_level: 'live_official_site' }] });
    const emails = collectEmails([f1, f2]).map((e) => e.email).sort();
    assert.deepStrictEqual(emails, ['info@grace.org', 'jeff.bogue@grace.org', 'office@grace.org']);
  });

  // ── new leadership roles ────────────────────────────────────────────────────
  check('roleFromTitle: Campus Pastor → campus_pastor', () => assert.strictEqual(roleFromTitle('Campus Pastor')?.field, 'campus_pastor'));
  check('roleFromTitle: Groups Director → groups_leader', () => assert.strictEqual(roleFromTitle('Groups Director')?.field, 'groups_leader'));
  check('roleFromTitle: Student Pastor → nextgen_leader', () => assert.strictEqual(roleFromTitle('Student Pastor')?.field, 'nextgen_leader'));
  check('roleFromTitle: Missions Director → outreach_missions_leader', () => assert.strictEqual(roleFromTitle('Missions Director')?.field, 'outreach_missions_leader'));

  // ── integration through normalize: map populated, junk preserved, roster classified ─
  const STAFFPAGE = 'Our Team\n\nJeff Bogue\nSenior Pastor\n\nMorgan Diaz\nCampus Pastor';
  const staff: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://grace.org/staff', title: 'Team', fetched: true, status: 200, category: 'staff',
    text: 'Jeff Bogue Senior Pastor jeff.bogue@grace.org. Morgan Diaz Campus Pastor. Give at giving@grace.org. Elder: papaperren@gmail.com',
    staffCards: extractStaffCards(STAFFPAGE),
    fields: [{ field_name: 'email', value: 'papaperren@gmail.com', confidence: 80, evidence_text: 'mailto', source_url: 'https://grace.org/staff', source_type: 'staff_page', access_level: 'live_official_site' }],
  });
  const findings = [staff];
  const norm = normalizeEvidence({ findings, facts: {}, leadership: aggregateLeadership(findings), techStack: detectTechStack(findings), strategicSignals: detectStrategicSignals(findings), conflicts: [] });
  const byEmail = new Map(norm.email_map.map((r) => [r.value, r]));
  check('normalize: email_map populated with all emails', () => assert.ok(norm.email_map.length >= 3));
  check('normalize: jeff.bogue@grace.org bucketed person → Jeff Bogue', () => {
    const r = byEmail.get('jeff.bogue@grace.org'); assert.ok(r); assert.strictEqual(r!.category, 'person'); assert.strictEqual(r!.detail, 'Jeff Bogue');
  });
  check('normalize: giving@grace.org bucketed role', () => assert.strictEqual(byEmail.get('giving@grace.org')?.category, 'role'));
  check('normalize: elder personal gmail PRESERVED as unassigned (not dropped)', () => {
    const r = byEmail.get('papaperren@gmail.com'); assert.ok(r, 'gmail must be preserved'); assert.strictEqual(r!.category, 'unassigned');
  });
  check('normalize: staff_roster carries the leadership-map role (Campus Pastor)', () => {
    assert.ok(norm.staff_roster.some((r) => r.value === 'Morgan Diaz' && r.category === 'campus_pastor'));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
