/**
 * Offline P7 proof: dossier-driven enrich-church on a single row, fully mocked
 * (no network / Supabase / Claude). Shows exactly which fields auto-update vs.
 * go to review vs. evidence-only under the conservative rules.
 *
 * ⚠️ PROVENANCE: this demo reuses the SYNTHETIC Cornerstone fixture from
 * researchDemo.ts plus a synthetic mock scoring response below. No value here is
 * tool-discovered; only the user-provided Cornerstone fields (name/city, lead
 * pastor, email, phone) are real.
 *
 *   npm run enrich-demo
 */
import { rmSync } from 'node:fs';
import { JsonStore } from './db/jsonStore.js';
import { MockLlmProvider, type ExtractOptions } from './claude/client.js';
import { ResilientResearch } from './research/resilient.js';
import { enrichChurch, type AgentContext } from './agents/index.js';
import { installMockFetch, synthesize } from './researchDemo.js';

const DB = 'data/output/enrich_demo_db.json';

/** Combined mock LLM: dossier synthesis + multiplication scoring. */
function responder(opts: ExtractOptions<unknown>): unknown {
  if (opts.system.includes('building a DOSSIER')) return synthesize(opts);
  // multiplication/scoring agent — SYNTHETIC mock output (not discovered).
  return {
    church_planting_activity: 15, disciple_making: 55, leadership_development: 45,
    residency_internship: 10, mission_sending: 50, kingdom_collaboration: 40,
    innovation: 45, multiplication_orientation: 35, digital_reach: 50,
    explanation: '[SYNTHETIC mock scoring output — not based on real evidence.]',
    evidence: [{ field_name: 'multiplication', proposed_value: 'moderate', evidence_text: '[SYNTHETIC mock evidence]', source_url: 'https://www.cornerstonechurch.info', confidence_score: 60 }],
  };
}

async function main() {
  rmSync(DB, { force: true });
  installMockFetch();
  const store = new JsonStore(DB);

  const { id } = await store.upsertImportRecord({
    original_row_id: 'demo-cornerstone', name: 'Cornerstone Church', address: null,
    city: 'Akron', state: 'OH', zip: null, country: 'United States',
    phone_original: null, email_original: null, website_original: 'https://www.cornerstonechurch.info',
    language: null, network_affiliation: null, notes: null,
  });

  const ctx: AgentContext = { store, llm: new MockLlmProvider(responder), research: new ResilientResearch() };
  console.log('=== enrich-church (dossier-driven, offline) ===\n');
  await enrichChurch(ctx, id);

  const c = (await store.getChurch(id))!;
  const reviews = await store.listReviewQueue('pending');
  const evidence = await store.listEvidence(id);
  const dossier = await store.getDossier(id);
  const conflicts = await store.listConflicts(id);

  console.log('\n=== church record after enrich ===');
  const show = (k: string) => console.log(`  ${k.padEnd(28)} ${(c as any)[k] ?? '—'}`);
  ['active_status', 'website_verified', 'lead_pastor', 'email_verified', 'phone_verified',
   'denomination', 'staff_count', 'campus_count', 'attendance_estimate', 'attendance_confidence',
   'lifecycle_stage', 'change_readiness_score', 'digital_maturity_score', 'staff_depth_score',
   'church_app_status', 'online_attendance_estimate', 'evidence_access_level',
   'identity_contamination_flag', 'research_confidence', 'influence_score', 'mmc_fit_score',
  ].forEach(show);

  console.log(`\n=== review queue (${reviews.length}) ===`);
  for (const r of reviews) console.log(`  ? ${r.field_name} -> "${r.proposed_value}" (conf ${r.confidence_score})`);

  console.log(`\n=== dossier ===  access=${dossier?.evidence_access_level} research_conf=${dossier?.research_confidence} sources=${dossier?.source_count} conflicts=${conflicts.length} contamination=${(dossier?.contamination_flags ?? []).length}`);
  console.log(`=== evidence rows: ${evidence.length} (annual_budget written: ${'annual_budget' in (c as any) && (c as any).annual_budget != null}) ===`);
}

main().catch((e) => { console.error(e); process.exit(1); });
