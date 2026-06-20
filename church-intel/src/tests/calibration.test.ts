/**
 * Offline verification of the calibration system: row building, derived
 * archetype/contactability, and report rendering — using the mocked Cornerstone
 * dossier (no live services).
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { rowFromBuild, deriveArchetype, type CalibrationEntry } from '../research/calibrationSet.js';
import { renderCalibrationReport } from '../research/calibrationReport.js';
import type { FieldMap } from '../research/calibration.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function fm(obj: Record<string, { value: any; confidence?: number }>): FieldMap {
  const out: FieldMap = {};
  for (const [k, v] of Object.entries(obj)) out[k] = { value: v.value, confidence: v.confidence ?? null };
  return out;
}

async function main() {
  console.log('calibration system');

  const { build } = await buildCornerstoneOffline();
  const entry: CalibrationEntry = { id: 'cornerstone-akron', name: 'Cornerstone Church', city: 'Akron', state: 'OH', url: 'https://www.cornerstonechurch.info' };
  const row = rowFromBuild(entry, build);

  check('row has identity + verdict', () => { assert.ok(row.identityVerdict); assert.ok('identity_confidence' in row); });
  check('row has lifecycle (mapped vocabulary)', () => assert.strictEqual(row.lifecycle.value, 'revitalizing'));
  check('row has archetype = Revitalization Church', () => assert.strictEqual(row.archetype.value, 'Revitalization Church'));
  check('archetype confidence capped by access', () => assert.ok(row.archetype.confidence <= 65));
  check('contactability is a score 0-100', () => { const s = Number(row.contactability.value); assert.ok(s >= 0 && s <= 100); });
  check('contacts include lead pastor', () => assert.ok(row.fields.lead_pastor?.value));

  check('deriveArchetype: multi-campus', () => {
    const a = deriveArchetype(fm({ avg_weekly_attendance: { value: 3000 }, campus_count: { value: 3 }, lifecycle_stage: { value: 'established' } }), 'live_official_site');
    assert.strictEqual(a.value, 'Multi-Campus Church');
  });
  check('deriveArchetype: plateaued mega', () => {
    const a = deriveArchetype(fm({ avg_weekly_attendance: { value: 4000 }, campus_count: { value: 1 }, lifecycle_stage: { value: 'plateaued' } }), 'live_official_site');
    assert.strictEqual(a.value, 'Plateaued Mega Church');
  });

  const md = renderCalibrationReport([row], {});
  check('report renders all sections', () => {
    for (const s of ['# Calibration Report', '### Identity', '### Contacts', '### Size', '### Strategic', '### Lifecycle', '### Archetype', '### Tool Assessment', '### Human Assessment', '### Variance', 'Additional analysis']) {
      assert.ok(md.includes(s), `missing section: ${s}`);
    }
  });
  check('report flags capped-confidence variance', () => assert.ok(/confidence capped/.test(md)));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
