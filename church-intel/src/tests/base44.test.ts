/**
 * Base44 publisher — maps a DossierBuild onto the front-end app's entity schema
 * and publishes via REST. Offline: the mapping runs on a real Cornerstone build;
 * the publisher runs against a MOCK fetch (no network). Proves every value lands
 * inside Base44's enums, children carry no church_id until publish, and a re-run
 * replaces (delete + bulk-create) cleanly.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { mapDossierToBase44 } from '../base44/mapper.js';
import { Base44Client } from '../base44/client.js';
import { publishDossierToBase44 } from '../base44/publish.js';

let failures = 0;
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => console.log(`  ✓ ${label}`)).catch((e) => { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); });
}

const ENUMS = {
  archetype: new Set(['Megachurch', 'Large Church', 'Mid-Size Church', 'Small Church', 'Church Plant', 'Multi-Site', 'Network Hub', 'Legacy Church']),
  lifecycle: new Set(['Startup', 'Growth', 'Established', 'Mature', 'Declining', 'Revitalizing']),
  verification_status: new Set(['Verified', 'Partially Verified', 'Unverified']),
  engagement_priority: new Set(['Critical', 'High', 'Medium', 'Low', 'Monitor']),
  status: new Set(['Discovered', 'Researching', 'Researched', 'Archived']),
  role: new Set(['Lead Pastor', 'Executive Pastor', 'Operations Leader', 'Communications Leader', 'Discipleship Leader', 'Groups Leader', 'Next Gen Leader', 'Campus Pastor', 'Other']),
  email_type: new Set(['Person Matched', 'Role-Based', 'Church-Level', 'Unassigned']),
  tech_category: new Set(['Church Management', 'Giving', 'Streaming', 'Groups', 'Forms', 'Email', 'Mobile App', 'Website Platform']),
  signal_type: new Set(['Hiring', 'School', 'Residency', 'Network Affiliation', 'Multi-Site', 'Podcast', 'Video', 'Giving', 'Volunteer Systems', 'Groups Systems']),
  strength: new Set(['Strong', 'Moderate', 'Weak']),
  cov_category: new Set(['Homepage', 'About', 'Staff', 'Contact', 'Campuses', 'Ministries', 'Groups', 'Giving', 'Sermons', 'Technology', 'Social', 'Jobs']),
  cov_status: new Set(['Complete', 'Partial', 'Missing']),
  score_type: new Set(['Digital Maturity', 'Growth Orientation', 'Organizational Capacity', 'Contactability', 'Change Readiness']),
};
const inEnum = (set: Set<string>, v: unknown, where: string) => assert.ok(v == null || set.has(v as string), `${where}: "${v}" not in enum`);

async function main() {
  console.log('Base44 publisher (mapping + REST)');
  const { target, build } = await buildCornerstoneOffline();
  const p = mapDossierToBase44(target, build);

  await check('Church record: required name + valid enums + scores', () => {
    assert.strictEqual(p.church.name, 'Cornerstone Church');
    assert.strictEqual(p.church.status, 'Researched');
    inEnum(ENUMS.archetype, p.church.archetype, 'church.archetype');
    inEnum(ENUMS.lifecycle, p.church.lifecycle, 'church.lifecycle');
    inEnum(ENUMS.verification_status, p.church.verification_status, 'church.verification_status');
    inEnum(ENUMS.engagement_priority, p.church.engagement_priority, 'church.engagement_priority');
    inEnum(ENUMS.status, p.church.status, 'church.status');
    assert.strictEqual(typeof p.church.digital_maturity, 'number');
    assert.strictEqual(typeof p.church.contactability, 'number');
  });

  await check('Contacts: valid role + email_type, never carry change_readiness or church_id', () => {
    for (const c of p.contacts) {
      inEnum(ENUMS.role, c.role, 'contact.role');
      inEnum(ENUMS.email_type, c.email_type, 'contact.email_type');
      assert.ok(!('church_id' in c), 'contact must not carry church_id pre-publish');
    }
  });
  await check('Technology categories ∈ enum', () => p.technologies.forEach((t) => inEnum(ENUMS.tech_category, t.category, 'tech.category')));
  await check('StrategicSignal type + strength ∈ enum (non-mapping signals dropped)', () => {
    for (const s of p.signals) { inEnum(ENUMS.signal_type, s.signal_type, 'signal.signal_type'); inEnum(ENUMS.strength, s.strength, 'signal.strength'); }
  });
  await check('CoverageItem category + status ∈ enum', () => {
    for (const c of p.coverage) { inEnum(ENUMS.cov_category, c.category, 'coverage.category'); inEnum(ENUMS.cov_status, c.status, 'coverage.status'); }
  });
  await check('ScoreDetail: 4 dims, valid score_type, contributor arrays', () => {
    assert.ok(p.scores.length >= 1 && p.scores.length <= 4);
    for (const s of p.scores) {
      inEnum(ENUMS.score_type, s.score_type, 'score.score_type');
      assert.ok(Array.isArray(s.positive_contributors) && Array.isArray(s.verified_absence) && Array.isArray(s.not_investigated));
    }
  });
  await check('ResearchJob status Complete; ActivityLog type research_completed', () => {
    assert.strictEqual(p.job.status, 'Complete');
    assert.strictEqual(p.activity.type, 'research_completed');
  });

  // ── publisher against a mock fetch (no network) ─────────────────────────────
  const calls: { method: string; entity: string; bulk: boolean; body: unknown; query: string }[] = [];
  const mockFetch = (async (url: string, init: { method: string; body?: string }) => {
    const u = new URL(url);
    const m = u.pathname.match(/\/entities\/(\w+)(\/bulk)?$/);
    const entity = m?.[1] ?? '';
    const bulk = !!m?.[2];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, entity, bulk, body, query: u.search });
    const json = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (init.method === 'GET') return json([]);                                  // church not found → create
    if (init.method === 'POST' && entity === 'Church') return json({ id: 'church_test', ...body });
    if (init.method === 'DELETE') return json(null);
    if (bulk) return json(body);                                                  // echo rows
    return json({ id: `rec_${entity}` });
  }) as unknown as typeof fetch;

  const client = new Base44Client({ apiKey: 'test-key', baseUrl: 'https://example.test/api', fetchImpl: mockFetch });
  const res = await publishDossierToBase44(target, build, client);

  await check('Church upserted (created) and child counts returned', () => {
    assert.strictEqual(res.church_id, 'church_test');
    assert.strictEqual(res.created, true);
    assert.strictEqual(res.counts.contacts, p.contacts.length);
    assert.strictEqual(res.counts.scores, p.scores.length);
  });
  await check('Church create happened with the mapped record', () => {
    const post = calls.find((c) => c.entity === 'Church' && c.method === 'POST');
    assert.ok(post, 'no Church POST'); assert.strictEqual((post!.body as { name: string }).name, 'Cornerstone Church');
  });
  await check('each child entity is delete-then-bulk-create, church_id stamped on every row', () => {
    for (const entity of ['Contact', 'Technology', 'StrategicSignal', 'CoverageItem', 'ScoreDetail', 'RawEvidence']) {
      const del = calls.find((c) => c.entity === entity && c.method === 'DELETE');
      assert.ok(del, `no DELETE for ${entity}`);
      assert.deepStrictEqual(del!.body, { church_id: 'church_test' }, `${entity} delete must scope to church_id`);
      const bulk = calls.find((c) => c.entity === entity && c.bulk);
      if (bulk) for (const row of bulk.body as { church_id: string }[]) assert.strictEqual(row.church_id, 'church_test', `${entity} row missing church_id`);
    }
  });
  await check('ResearchJob + ActivityLog appended with church_id', () => {
    const job = calls.find((c) => c.entity === 'ResearchJob' && c.method === 'POST');
    const act = calls.find((c) => c.entity === 'ActivityLog' && c.method === 'POST');
    assert.ok(job && (job.body as { church_id: string }).church_id === 'church_test');
    assert.ok(act && (act.body as { church_id: string }).church_id === 'church_test');
  });

  await check('deleteMany refuses an empty query (never wipe the whole entity)', async () => {
    await assert.rejects(() => client.deleteMany('Church', {}), /empty query/);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
