/**
 * Stage 4 — Outreach Intelligence + the stage-boundary guard.
 *
 * Proves the dossier is relationship intelligence derived from evidence, and —
 * critically — that it INVENTS NOTHING: every email rendered exists in the
 * Stage-2 email map, every outreach contact is a real extracted person, and a
 * person with no email reads "not found" rather than a fabricated address.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildOutreachIntel } from '../research/outreachIntel.js';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { renderDossierMarkdown } from '../research/dossierMarkdown.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Stage 4 — Outreach Intelligence + no-invention guard');

  const { target, build } = await buildCornerstoneOffline();
  const oi = buildOutreachIntel({ interpretation: build.interpretation, normalized: build.normalized, scores: build.strategicScores, recommendations: build.recommendations, sizeRelative: build.sizeRelative });

  // ── outreach intelligence shape ─────────────────────────────────────────────
  const rosterNames = new Set([...build.normalized.leaders, ...build.normalized.staff_roster].map((r) => r.value.toLowerCase()));
  check('best first contact is a REAL extracted person (not invented)', () => {
    assert.ok(oi.best_first_contact, 'expected a best contact');
    assert.ok(rosterNames.has(oi.best_first_contact!.name.toLowerCase()), `${oi.best_first_contact!.name} not in roster`);
  });
  check('fallback contact (if any) is also a real extracted person', () => {
    if (oi.fallback_contact) assert.ok(rosterNames.has(oi.fallback_contact.name.toLowerCase()));
  });
  check('always advises NOT to let comms own the initiative', () => assert.ok(oi.do_not_lead_with.some((x) => /comms|marketing/i.test(x))));
  check('message angle + supporting evidence are present', () => { assert.ok(oi.message_angle.length > 0); assert.ok(oi.supporting_evidence.length > 0); });
  check('inferred attendance is surfaced as a risk (do not cite a number)', () => {
    if (build.interpretation.attendance_source !== 'reported') assert.ok(oi.risks.some((x) => /inferred/i.test(x)));
  });
  check('a contact with no email carries email=null (never fabricated)', () => {
    for (const c of [oi.best_first_contact, oi.fallback_contact]) if (c) assert.ok(c.email === null || /@/.test(c.email));
  });

  // ── STAGE-BOUNDARY GUARD: the dossier invents no emails ─────────────────────
  const md = renderDossierMarkdown(target, build);
  const allowed = new Set<string>(build.normalized.email_map.map((e) => e.value.toLowerCase()));
  if (build.interpretation.office_email.value) allowed.add(build.interpretation.office_email.value.toLowerCase());
  const inDossier = (md.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase());
  check('every email in the dossier traces to the Stage-2 email map (no invention)', () => {
    const invented = inDossier.filter((e) => !allowed.has(e));
    assert.strictEqual(invented.length, 0, `invented emails: ${invented.join(', ')}`);
  });
  check('dossier renders the Outreach Intelligence section', () => assert.match(md, /## 9\. Outreach Intelligence/));
  check('missing per-person email renders "not found", not a fake address', () => {
    // Cornerstone is snippet-only — at least one access line should say "not found".
    assert.ok(/email: not found|email not found/.test(md));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
