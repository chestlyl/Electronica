/**
 * Area Prospecting — enumerate UNKNOWN churches in a region, dedupe, tag
 * known-vs-roster, score + rank by Engagement Fit. Orchestration is tested
 * offline with mocked enumerators, roster, and dossier builder (no network,
 * no Places key, no Supabase).
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import {
  prospectArea, dedupeCandidates, isKnown, normName, domainOf, renderProspectBoard,
  type ChurchCandidate, type ProspectProvider, type KnownChurch,
} from '../research/prospect.js';
import type { DossierBuild, ResearchTarget } from '../research/researchAgent.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const cand = (name: string, state: string | null, website: string | null, source: string): ChurchCandidate =>
  ({ name, city: null, state, website, sources: [source] });

// Mock dossier builder: fit keyed by church name (deterministic).
const FIT: Record<string, number> = { 'New Hope': 78, 'First Baptist': 41, 'Grace Church': 88, 'Riverside': 60 };
function mockDossier(target: ResearchTarget): Promise<DossierBuild> {
  const fit = FIT[target.name] ?? 30;
  const dim = (score: number) => ({ score });
  return Promise.resolve({
    officialSite: target.originalWebsite ?? `https://resolved.example/${normName(target.name).replace(/\s/g, '')}`,
    accessLevel: 'live_official_site',
    interpretation: { archetype: { value: 'Growth Church' }, attendance_estimate: { value: 500 } },
    strategicScores: {
      digital_maturity: dim(50), growth_orientation: dim(fit), organizational_capacity: dim(55), contactability: dim(60),
    },
    recommendations: {
      engagement_fit: { value: fit }, engagement_priority: { value: fit >= 62 ? 'high' : 'medium' },
      recommended_entry_point: { value: 'Lead Pastor' },
    },
  } as unknown as DossierBuild);
}

function provider(name: string, items: ChurchCandidate[]): ProspectProvider {
  return { name, enumerate: async () => items };
}

async function main() {
  console.log('Area Prospecting — enumerate, dedupe, tag, rank');

  // ── dedupe ────────────────────────────────────────────────────────────────
  check('normName strips church/the/of and punctuation', () => {
    assert.strictEqual(normName('The First Baptist Church of Akron'), 'first baptist akron');
  });
  check('domainOf normalizes www + scheme', () => assert.strictEqual(domainOf('https://www.GraceChurches.org/about'), 'gracechurches.org'));
  check('dedupeCandidates merges same domain and same name+state', () => {
    const merged = dedupeCandidates([
      cand('Grace Church', 'OH', 'https://www.gracechurches.org', 'google_places'),
      cand('Grace Church', 'OH', null, 'search_directory'),          // same name+state → merge
      cand('Grace', 'OH', 'http://gracechurches.org/give', 'search_directory'), // same domain → merge
      cand('First Baptist', 'OH', null, 'google_places'),
    ]);
    assert.strictEqual(merged.length, 2, `got ${merged.length}`);
    const grace = merged.find((m) => /grace/i.test(m.name))!;
    assert.ok(grace.sources.includes('google_places') && grace.sources.includes('search_directory'));
    assert.strictEqual(grace.website, 'https://www.gracechurches.org'); // first non-null wins
  });

  // ── known/unknown tagging ───────────────────────────────────────────────────
  const roster: KnownChurch[] = [{ name: 'Grace Church', website: 'https://www.gracechurches.org', state: 'OH' }];
  check('isKnown: domain match', () => assert.ok(isKnown(cand('Totally Different Name', 'OH', 'https://gracechurches.org', 'x'), roster)));
  check('isKnown: name+state match', () => assert.ok(isKnown(cand('Grace Church', 'OH', null, 'x'), roster)));
  check('isKnown: unknown church is not flagged', () => assert.ok(!isKnown(cand('New Hope', 'OH', 'https://newhope.org', 'x'), roster)));

  // ── full orchestration ──────────────────────────────────────────────────────
  const pPlaces = provider('google_places', [
    cand('Grace Church', 'OH', 'https://www.gracechurches.org', 'google_places'),
    cand('First Baptist', 'OH', null, 'google_places'),
    cand('New Hope', 'OH', null, 'google_places'),
  ]);
  const pSearch = provider('search_directory', [
    cand('Grace Church', 'OH', null, 'search_directory'),  // dup of Places Grace
    cand('Riverside', 'OH', null, 'search_directory'),
  ]);
  const board = await prospectArea(
    { metro: 'Greater Akron', state: 'OH', limit: 3 },
    { enumerators: [pPlaces, pSearch], knownRoster: async () => roster, buildDossier: mockDossier },
  );

  check('enumerate+dedupe → 4 distinct churches', () => assert.strictEqual(board.total_found, 4));
  check('tagging → 1 known (Grace), 3 unknown', () => { assert.strictEqual(board.known_count, 1); assert.strictEqual(board.unknown_count, 3); });
  check('budget (limit 3) dossiers UNKNOWN churches first (Grace excluded)', () => {
    assert.strictEqual(board.dossiered, 3);
    assert.ok(!board.entries.some((e) => e.name === 'Grace Church'), 'known Grace should be outside the budget');
    assert.ok(board.entries.every((e) => !e.known));
  });
  check('ranked by Engagement Fit desc (New Hope 78 > Riverside 60 > First Baptist 41)', () => {
    assert.deepStrictEqual(board.entries.map((e) => e.name), ['New Hope', 'Riverside', 'First Baptist']);
    assert.ok(board.entries[0].fit >= board.entries[1].fit && board.entries[1].fit >= board.entries[2].fit);
  });

  // ── known included when budget allows ───────────────────────────────────────
  const board2 = await prospectArea(
    { metro: 'Greater Akron', state: 'OH', limit: 10 },
    { enumerators: [pPlaces, pSearch], knownRoster: async () => roster, buildDossier: mockDossier },
  );
  check('larger budget includes the known church, still ranked by fit', () => {
    assert.strictEqual(board2.dossiered, 4);
    assert.strictEqual(board2.entries[0].name, 'Grace Church'); // fit 88, highest
    assert.ok(board2.entries[0].known);
  });

  check('renderProspectBoard flags NEW for unknowns', () => {
    const md = renderProspectBoard(board2);
    assert.match(md, /# Area Prospecting — Greater Akron, OH/);
    assert.match(md, /\*\*NEW\*\*/);       // unknowns flagged
    assert.match(md, /New Hope/);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
