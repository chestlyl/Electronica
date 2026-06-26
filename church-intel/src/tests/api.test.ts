/**
 * CIP API seam (Base44 ↔ Church Intelligence Agent). The pipeline is MOCKED so
 * the API contract is exercised without Claude/Supabase/Chromium/network. Covers
 * the 7 required cases: job kickoff, polling, dossier persistence, repository
 * listing, dossier retrieval, fail-closed jobs, and auth.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApp } from '../api/app.js';
import { InMemoryCipStore } from '../api/store.js';
import type { PipelineRunner, KnownChurchInput, DiscoveryInput, StageEmitter, KnownChurchOutput, DiscoveryOutput } from '../api/pipeline.js';
import type { DossierSections } from '../api/contract.js';

const API_KEY = 'test-cip-key';

let failures = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function mockSections(name: string): DossierSections {
  return {
    identity: { official_website: 'https://x.org', website_verified: true, denomination: 'Non-denominational' },
    coverage: { coveragePercent: 88 },
    size: { awa: 1800, attendance_source: 'inferred' },
    leadership_access: [{ role: 'Lead Pastor', name: 'Pat Lead', email: 'pat@x.org', confidence: 80 }],
    staff_emails: { church_emails: [{ value: 'info@x.org' }], role_emails: [], person_emails: [], unassigned_emails: [] },
    technology_stack: [{ platform_name: 'Church Center' }],
    strategic_signals: [{ category: 'jobs_hiring' }],
    strategic_scores: { digital_maturity: { score: 60 } },
    recommendations: { engagement_fit: { value: 76 }, engagement_priority: { value: 'high' } },
    outreach_intelligence: { best_first_contact: { name: 'Pat Lead' } },
    raw_evidence: [{ id: 'raw_1' }],
    markdown: `# Research Dossier — ${name}\n\nMock dossier body.`,
  };
}

/** Mock pipeline: drives every stage, then returns mapped fixture data. A church
 *  named "FAIL CHURCH" throws to exercise fail-closed behavior. */
class MockPipeline implements PipelineRunner {
  async runKnownChurch(input: KnownChurchInput, onStage: StageEmitter): Promise<KnownChurchOutput> {
    await onStage('extraction', 35);
    await onStage('coverage_validation', 70);
    await onStage('scoring', 85);
    if (input.name === 'FAIL CHURCH') throw new Error('synthetic pipeline failure');
    return {
      church: {
        name: input.name, city: input.city ?? null, state: input.state ?? null, website: 'https://x.org',
        verified: true, denomination: 'Non-denominational', archetype: 'Multi-Campus Church', lifecycle: 'established',
        awa: 1800, attendance_source: 'inferred', coverage_percent: 88, research_confidence: 74,
        engagement_fit: 76, priority: 'high',
      },
      sections: mockSections(input.name),
    };
  }
  async runDiscovery(_input: DiscoveryInput, onStage: StageEmitter): Promise<DiscoveryOutput> {
    await onStage('scoring', 80);
    return {
      churches: [{
        name: 'Discovered Church', city: 'Nashville', state: 'TN', website: 'https://disc.org', verified: false,
        denomination: null, archetype: 'Single-Site Church', lifecycle: null, awa: 500, attendance_source: null,
        coverage_percent: null, research_confidence: null, engagement_fit: 60, priority: 'medium',
      }],
      board: { status: 'ok' },
    };
  }
}

function makeServer() {
  const store = new InMemoryCipStore();
  const { app, jobs } = createApp({ store, pipeline: new MockPipeline(), apiKey: API_KEY });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const call = (method: string, path: string, body?: unknown, auth = true) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${API_KEY}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, jobs, server, call };
}

async function main() {
  console.log('CIP API seam (mocked pipeline)');
  const { jobs, server, call } = makeServer();

  try {
    // 1. POST known-church returns a job_id immediately (status queued).
    let knownChurchId = '';
    let knownJobId = '';
    await check('POST /research/known-church returns job_id + church_id immediately', async () => {
      const res = await call('POST', '/research/known-church', { name: 'Cross Point Church', city: 'Nashville', state: 'TN', url: 'https://crosspoint.tv' });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.job_id?.startsWith('job_'), 'job_id prefix');
      assert.ok(body.church_id?.startsWith('church_'), 'church_id prefix');
      assert.strictEqual(body.status, 'queued');
      assert.strictEqual(body.message, 'Known church research started');
      knownJobId = body.job_id; knownChurchId = body.church_id;
    });

    // 2. GET jobs/:id returns stage + progress with allowed values.
    await check('GET /research/jobs/:id returns stage + progress', async () => {
      const res = await call('GET', `/research/jobs/${knownJobId}`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.job_id, knownJobId);
      assert.ok(['queued', 'running', 'complete', 'failed'].includes(body.status), `status ${body.status}`);
      assert.ok(['queued', 'discovery', 'extraction', 'coverage_validation', 'scoring', 'dossier_generation', 'complete', 'failed'].includes(body.stage), `stage ${body.stage}`);
      assert.strictEqual(typeof body.progress, 'number');
    });

    // Let the background job finish.
    await jobs.idle();

    // 3. Completed known-church job stores a dossier + completes with result.
    await check('completed job → status complete, result has church_id + dossier_id', async () => {
      const res = await call('GET', `/research/jobs/${knownJobId}`);
      const body = await res.json();
      assert.strictEqual(body.status, 'complete');
      assert.strictEqual(body.stage, 'complete');
      assert.strictEqual(body.progress, 100);
      assert.strictEqual(body.result.church_id, knownChurchId);
      assert.ok(body.result.dossier_id?.startsWith('dossier_'), 'dossier_id prefix');
    });

    // 4. GET /churches returns the repository rows.
    await check('GET /churches lists the researched church', async () => {
      const res = await call('GET', '/churches?state=TN');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.total >= 1, `total ${body.total}`);
      const row = body.churches.find((c: { church_id: string }) => c.church_id === knownChurchId);
      assert.ok(row, 'researched church present');
      assert.strictEqual(row.engagement_fit, 76);
      assert.strictEqual(row.priority, 'high');
      assert.strictEqual(row.coverage_percent, 88);
      assert.ok(row.last_researched_at, 'last_researched_at set');
    });

    // 5. GET /churches/:id/dossier returns markdown + structured sections.
    await check('GET /churches/:id/dossier returns markdown + sections', async () => {
      const res = await call('GET', `/churches/${knownChurchId}/dossier`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.church_id, knownChurchId);
      assert.ok(body.dossier_id?.startsWith('dossier_'));
      assert.match(body.markdown, /# Research Dossier — Cross Point Church/);
      for (const k of ['identity', 'coverage', 'size', 'leadership_access', 'staff_emails', 'technology_stack', 'strategic_signals', 'strategic_scores', 'recommendations', 'outreach_intelligence', 'raw_evidence']) {
        assert.ok(k in body, `missing section ${k}`);
      }
      assert.ok(Array.isArray(body.leadership_access) && body.leadership_access.length >= 1);
    });

    // 6. Failed jobs store error and do NOT crash the server.
    await check('failed job stores error; server stays up', async () => {
      const res = await call('POST', '/research/known-church', { name: 'FAIL CHURCH' });
      const { job_id } = await res.json();
      await jobs.idle();
      const jr = await (await call('GET', `/research/jobs/${job_id}`)).json();
      assert.strictEqual(jr.status, 'failed');
      assert.strictEqual(jr.stage, 'failed');
      assert.match(jr.error, /synthetic pipeline failure/);
      // server still serving:
      const health = await call('GET', '/churches');
      assert.strictEqual(health.status, 200);
    });

    // Discovery kickoff returns immediately (no church_id on the response).
    await check('POST /research/discovery-query returns job_id immediately', async () => {
      const res = await call('POST', '/research/discovery-query', { metro: 'Nashville', state: 'TN', limit: 10, filters: { unknown_only: true } });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.job_id?.startsWith('job_'));
      assert.strictEqual(body.message, 'Discovery job started');
      await jobs.idle();
      const jr = await (await call('GET', `/research/jobs/${body.job_id}`)).json();
      assert.strictEqual(jr.status, 'complete');
      assert.strictEqual(jr.result.count, 1);
    });

    // 7. Unauthorized requests return 401.
    await check('missing bearer token → 401', async () => {
      const res = await call('GET', '/churches', undefined, false);
      assert.strictEqual(res.status, 401);
    });
    await check('wrong bearer token → 401', async () => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/churches`, { headers: { authorization: 'Bearer nope' } });
      assert.strictEqual(res.status, 401);
    });
    await check('validation: missing name → 400 (still authorized path)', async () => {
      const res = await call('POST', '/research/known-church', { city: 'Nashville' });
      assert.strictEqual(res.status, 400);
    });
  } finally {
    server.close();
  }

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
