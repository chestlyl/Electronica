/**
 * Prospect-Gap guard — the "do-not-research existing churches" filter.
 *
 * Proves the matcher's decisions (domain / name+geo / phone / alias / fuzzy+geo
 * → exclude; uncertain → review; different church → net-new) AND that the
 * prospectArea integration NEVER builds a dossier for an excluded/ambiguous
 * candidate (no Claude/dossier budget spent on existing churches).
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import {
  ExistingIndex, nameSimilarity, phoneKey, stateCode, type ExistingChurch,
} from '../research/prospectGap.js';
import { prospectArea, type ChurchCandidate, type ProspectProvider } from '../research/prospect.js';
import type { DossierBuild } from '../research/researchAgent.js';

let failures = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function ex(p: Partial<ExistingChurch> & { name: string }): ExistingChurch {
  return { name: p.name, website: p.website ?? null, city: p.city ?? null, state: p.state ?? null, phone: p.phone ?? null, aliases: p.aliases ?? [], denomination: p.denomination ?? null, source: p.source ?? 'test' };
}

async function main() {
  console.log('prospect-gap (existing-church guard)');

  const existing: ExistingChurch[] = [
    ex({ name: 'One City Church', website: 'https://theonecity.org', city: 'Nashville', state: 'TN', phone: '(615) 555-1000' }),
    ex({ name: 'Cross Point Church', website: 'https://crosspoint.tv', city: 'Nashville', state: 'TN' }),
    ex({ name: 'Redemption Church', city: 'Gilbert', state: 'AZ', phone: '480-892-8475' }),
    ex({ name: 'Grace Community Church', city: 'Akron', state: 'OH' }),
    ex({ name: 'Life.Church', website: 'https://life.church', city: 'Edmond', state: 'OK' }),
  ];
  const idx = new ExistingIndex(existing);

  // ── helpers ────────────────────────────────────────────────────────────────
  check('stateCode coerces name/code/case → 2-letter', () => {
    assert.strictEqual(stateCode('Ohio'), 'OH');
    assert.strictEqual(stateCode('oh'), 'OH');
    assert.strictEqual(stateCode('OK'), 'OK');
    assert.strictEqual(stateCode('Nowhere'), null);
  });
  check('phoneKey normalizes to last-10-digits', () => {
    assert.strictEqual(phoneKey('(615) 555-1000'), '6155551000');
    assert.strictEqual(phoneKey('1-615-555-1000'), '6155551000');
    assert.strictEqual(phoneKey('555-1000'), null);
  });
  check('nameSimilarity: identical high, unrelated low', () => {
    assert.ok(nameSimilarity('Cross Point Church', 'Crosspoint Church') > 0.8);
    assert.ok(nameSimilarity('One City Church', 'Redemption Church') < 0.5);
  });

  // ── exact keys → exclude ─────────────────────────────────────────────────────
  check('exact domain → exclude (geo-independent)', () => {
    const m = idx.match({ name: 'Totally Different Name', website: 'http://www.theonecity.org/give', state: null });
    assert.ok(m && m.decision === 'exclude' && m.reason === 'domain');
  });
  check('exact normalized name + same state → exclude', () => {
    const m = idx.match({ name: 'Cross Point Church', city: 'Nashville', state: 'TN' });
    assert.ok(m && m.decision === 'exclude' && m.reason === 'name+geo');
  });
  check('phone match (candidate carries phone) → exclude', () => {
    const m = idx.match({ name: 'Some Plant', state: 'AZ', phone: '480.892.8475' });
    assert.ok(m && m.decision === 'exclude' && m.reason === 'phone');
  });
  check('known alias ("LifeChurch.tv" → Life.Church) → exclude', () => {
    const m = idx.match({ name: 'LifeChurch.tv', city: 'Edmond', state: 'OK' });
    assert.ok(m && m.decision === 'exclude' && m.reason === 'alias');
  });
  check('fuzzy name + same city/state → exclude', () => {
    const m = idx.match({ name: 'Crosspoint Church', city: 'Nashville', state: 'TN' });
    assert.ok(m && m.decision === 'exclude' && m.reason === 'fuzzy+geo', `got ${JSON.stringify(m)}`);
  });

  // ── ambiguous → review ───────────────────────────────────────────────────────
  check('exact name, geo unconfirmed → review (not excluded)', () => {
    const m = idx.match({ name: 'Cross Point Church', city: null, state: null });
    assert.ok(m && m.decision === 'review' && m.reason === 'name-nogeo', `got ${JSON.stringify(m)}`);
  });
  check('fuzzy name, no geo → review', () => {
    const m = idx.match({ name: 'Grace Community', city: null, state: null });
    assert.ok(m && m.decision === 'review', `got ${JSON.stringify(m)}`);
  });

  // ── net-new → null ───────────────────────────────────────────────────────────
  check('same name in a DIFFERENT state → net-new (null)', () => {
    const m = idx.match({ name: 'Grace Community Church', city: 'Cleveland', state: 'TN' });
    assert.strictEqual(m, null);
  });
  check('unrelated church → net-new (null)', () => {
    const m = idx.match({ name: 'Harvest Bible Chapel', city: 'Cleveland', state: 'OH' });
    assert.strictEqual(m, null);
  });

  // ── integration: prospectArea NEVER dossiers an excluded/ambiguous church ─────
  const candidates: ChurchCandidate[] = [
    { name: 'One City Church', city: 'Nashville', state: 'TN', website: 'https://theonecity.org', sources: ['google_places'] }, // exclude: domain
    { name: 'Crosspoint Church', city: 'Nashville', state: 'TN', website: null, sources: ['google_places'] },                    // exclude: fuzzy+geo
    { name: 'Cross Point Church', city: null, state: null, website: null, sources: ['google_places'] },                          // review: name-nogeo
    { name: 'Anchor Church', city: 'Cleveland', state: 'OH', website: 'https://anchorchurch.example', sources: ['google_places'] }, // net-new
    { name: 'Bay Church', city: 'Akron', state: 'OH', website: 'https://baychurch.example', sources: ['google_places'] },         // net-new
  ];
  const provider: ProspectProvider = { name: 'google_places', async enumerate() { return candidates; } };
  const dossiered: string[] = [];
  const board = await prospectArea(
    { metro: 'Cleveland', state: 'OH', limit: 50 },
    {
      enumerators: [provider],
      knownRoster: async () => [],
      buildDossier: async (t): Promise<DossierBuild> => {
        dossiered.push(t.name);
        // minimal DossierBuild-shaped stub (only the fields toEntry reads)
        return {
          officialSite: t.originalWebsite ?? null, accessLevel: 'public',
          interpretation: { archetype: { value: 'Mid-Size Church' }, attendance_estimate: { value: 400 } },
          strategicScores: { digital_maturity: { score: 60 }, growth_orientation: { score: 55 }, organizational_capacity: { score: 50 }, contactability: { score: 70 } },
          recommendations: { engagement_fit: { value: 72 }, engagement_priority: { value: 'High' }, recommended_entry_point: { value: 'Lead Pastor' } },
        } as unknown as DossierBuild;
      },
      excludeExisting: (c) => {
        const m = idx.match(c);
        if (!m) return null;
        return { decision: m.decision, reason: m.reason, confidence: m.confidence, matched: m.existing.name, matched_source: m.existing.source, detail: m.detail };
      },
    },
  );

  await check('excluded churches were diverted (2) and NEVER dossiered', () => {
    assert.strictEqual(board.excluded.length, 2, `excluded=${JSON.stringify(board.excluded.map((e) => e.name))}`);
    assert.ok(!dossiered.includes('One City Church'));
    assert.ok(!dossiered.includes('Crosspoint Church'));
  });
  await check('ambiguous church surfaced (1) and NEVER dossiered', () => {
    assert.strictEqual(board.ambiguous.length, 1, `ambiguous=${JSON.stringify(board.ambiguous.map((e) => e.name))}`);
    assert.ok(!dossiered.includes('Cross Point Church'));
  });
  await check('only the 2 net-new churches were dossiered', () => {
    assert.strictEqual(board.dossiered, 2, `dossiered=${JSON.stringify(dossiered)}`);
    assert.deepStrictEqual([...dossiered].sort(), ['Anchor Church', 'Bay Church']);
  });
  await check('exclusion records carry the matched existing church + reason', () => {
    const oneCity = board.excluded.find((e) => e.name === 'One City Church');
    assert.ok(oneCity && oneCity.matched === 'One City Church' && oneCity.reason === 'domain');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
