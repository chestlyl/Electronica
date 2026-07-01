/**
 * cip-batch core — parse a churches list and research it into the store with
 * bounded concurrency. Mock pipeline (one church fails) proves the batch
 * persists each church + dossier, tolerates failures, and respects concurrency.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { parseChurchList, researchBatch } from '../api/batch.js';
import { InMemoryCipStore } from '../api/store.js';
import type { PipelineRunner, KnownChurchInput, StageEmitter, KnownChurchOutput, DiscoveryOutput } from '../api/pipeline.js';
import type { DossierSections } from '../api/contract.js';

let failures = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function sections(name: string): DossierSections {
  return {
    identity: {}, coverage: {}, size: {}, leadership_access: [], staff_emails: {}, technology_stack: [],
    strategic_signals: [], strategic_scores: {}, recommendations: { engagement_fit: { value: 70 }, engagement_priority: { value: 'High' } },
    outreach_intelligence: {}, raw_evidence: [], markdown: `# ${name}`,
  };
}

let concurrentPeak = 0;
let active = 0;
class MockPipeline implements PipelineRunner {
  async runKnownChurch(input: KnownChurchInput, onStage: StageEmitter): Promise<KnownChurchOutput> {
    active++; concurrentPeak = Math.max(concurrentPeak, active);
    await onStage('extraction', 40);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    if (input.name === 'FAIL CHURCH') throw new Error('synthetic failure');
    return {
      church: { name: input.name, city: input.city ?? null, state: input.state ?? null, website: input.url ?? null, verified: true, denomination: null, archetype: 'Mid-Size Church', lifecycle: 'Growth', awa: 500, attendance_source: 'inferred', coverage_percent: 60, research_confidence: 75, engagement_fit: 70, priority: 'High' },
      sections: sections(input.name),
    };
  }
  async runDiscovery(_i: unknown, _o: unknown): Promise<DiscoveryOutput> { return { churches: [], board: {} }; }
}

async function main() {
  console.log('cip-batch (parse + researchBatch)');

  check('parseChurchList reads JSON array', () => {
    const list = parseChurchList('[{"name":"One City","website":"https://theonecity.org","state":"TN"}]', 'x.json');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'One City');
    assert.strictEqual(list[0].url, 'https://theonecity.org');
  });
  check('parseChurchList reads CSV with header (website→url)', () => {
    const csv = 'name,website,city,state\nCross Point,https://crosspoint.tv,Nashville,TN\nThe Belonging Co,,Nashville,TN';
    const list = parseChurchList(csv, 'x.csv');
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].url, 'https://crosspoint.tv');
    assert.strictEqual(list[1].url, null);
    assert.strictEqual(list[1].name, 'The Belonging Co');
  });

  const store = new InMemoryCipStore();
  const churches = [
    { name: 'One City Church', url: 'https://theonecity.org', state: 'TN' },
    { name: 'Cross Point Church', url: 'https://crosspoint.tv', state: 'TN' },
    { name: 'FAIL CHURCH' },
    { name: 'Church of the City', state: 'TN' },
  ];
  const results = await researchBatch(store, new MockPipeline(), churches, { concurrency: 2, pollMs: 10 });

  await check('every church produced a result; failures tolerated (not thrown)', () => {
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results.filter((r) => r.status === 'complete').length, 3);
    assert.strictEqual(results.filter((r) => r.status === 'failed').length, 1);
    assert.ok(results.find((r) => r.name === 'FAIL CHURCH')?.error?.includes('synthetic failure'));
  });
  await check('researched churches persisted to the store repository', async () => {
    const { churches: rows, total } = await store.listChurches({ limit: 100 });
    assert.ok(total >= 3, `expected >=3 persisted, got ${total}`);
    assert.ok(rows.some((c) => c.name === 'One City Church' && c.engagement_fit === 70));
  });
  await check('dossier persisted for a completed church', async () => {
    const one = (await store.listChurches({ q: 'One City', limit: 1 })).churches[0];
    const dossier = await store.getDossierByChurch(one.church_id);
    assert.ok(dossier && dossier.markdown.includes('One City Church'));
  });
  await check('concurrency was bounded to 2', () => {
    assert.ok(concurrentPeak <= 2, `peak concurrency ${concurrentPeak} exceeded 2`);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
