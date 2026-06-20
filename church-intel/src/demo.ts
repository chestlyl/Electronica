/**
 * Offline sample run (deliverable #10).
 *
 * Runs the FULL pipeline — import → verify → contact → denomination → size →
 * scoring → review queue → export — against 5 churches from the real
 * spreadsheet, using a file-backed store and deterministic MOCK Claude +
 * Playwright providers. No Supabase, Anthropic, or network access required.
 *
 * The production path (`npm run cli ...`) uses the identical agents with the
 * Supabase store and live Claude + Playwright providers.
 *
 *   npm run demo
 */
import { rmSync } from 'node:fs';
import { JsonStore } from './db/jsonStore.js';
import { MockLlmProvider, type ExtractOptions } from './claude/client.js';
import { importSpreadsheet } from './importer/importSpreadsheet.js';
import { enrichChurch, type AgentContext } from './agents/index.js';
import { processReviewQueue } from './review.js';
import { exportResults } from './export.js';
import type {
  ResearchBundle,
  ResearchInput,
  ResearchProvider,
} from './research/types.js';

const DB_PATH = 'data/output/demo_db.json';
const SEED_XLSX = 'data/Church_Data_v1.xlsx';

// Deterministic 0..1 from a string seed.
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mock research: fabricate a coherent official-site bundle from seed data. */
class MockResearch implements ResearchProvider {
  async research(input: ResearchInput): Promise<ResearchBundle> {
    const site = input.originalWebsite ?? `https://www.${slug(input.name)}.org`;
    const home = {
      url: site,
      finalUrl: site,
      ok: true,
      status: 200,
      title: `${input.name} | Church of the Nazarene`,
      category: 'home',
      fetchedAt: new Date().toISOString(),
      text: `Welcome to ${input.name} in ${input.city}, ${input.state}. ` +
        `We are a Church of the Nazarene congregation. Join us Sunday at 9:00 and ` +
        `10:45am. Led by our Lead Pastor. We support local and global missions and ` +
        `leadership development through our discipleship pathway.`,
    };
    return {
      query: `${input.name} ${input.city} ${input.state} church`,
      searchResults: [{ title: input.name, url: site, snippet: home.text.slice(0, 120) }],
      officialSite: site,
      originalSiteWorks: !!input.originalWebsite,
      pages: [home],
      robotsBlockedUrls: [],
    };
  }
  async close() {}
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function pickName(user: string): string {
  return (user.match(/CHURCH:\s*(.*)/)?.[1] ?? 'unknown').trim();
}

/** Mock Claude: returns schema-valid, deterministic-but-varied outputs. */
function mockResponder(opts: ExtractOptions<unknown>): unknown {
  const sys = opts.system;
  const name = pickName(opts.user);
  const r = rng(name);
  const conf = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

  if (sys.includes('church verification analyst')) {
    const c = conf(72, 96);
    return {
      active_status: c > 85 ? 'Verified Active' : 'Likely Active',
      active_status_confidence: c,
      website_verified: `https://www.${slug(name)}.org`,
      website_verified_confidence: conf(70, 95),
      closure_merger_signals: [],
      reasoning: `Active service times and recent content found on the official site for ${name}.`,
      evidence: [{
        field_name: 'active_status',
        proposed_value: 'Verified Active',
        evidence_text: 'Homepage lists current Sunday service times (9:00 & 10:45am).',
        source_url: `https://www.${slug(name)}.org`,
        confidence_score: c,
      }],
    };
  }
  if (sys.includes('PUBLIC-FACING church contact')) {
    return {
      email_verified: `info@${slug(name)}.org`,
      email_confidence: conf(60, 92),
      phone_verified: null,
      phone_confidence: 30,
      lead_pastor: `Pastor ${['John', 'David', 'Michael', 'Steven', 'Mark'][Math.floor(r() * 5)]} Smith`,
      lead_pastor_confidence: conf(58, 90),
      evidence: [{
        field_name: 'lead_pastor',
        proposed_value: 'Lead Pastor',
        evidence_text: 'Staff page lists the senior/lead pastor.',
        source_url: `https://www.${slug(name)}.org/staff`,
        confidence_score: conf(58, 90),
      }],
    };
  }
  if (sys.includes('classify a church')) {
    return {
      denomination: 'Nazarene',
      denomination_confidence: conf(80, 97),
      network_affiliation: 'Church of the Nazarene',
      network_confidence: conf(70, 92),
      evidence: [{
        field_name: 'denomination',
        proposed_value: 'Nazarene',
        evidence_text: 'Footer and About page state "Church of the Nazarene".',
        source_url: `https://www.${slug(name)}.org/about`,
        confidence_score: conf(80, 97),
      }],
    };
  }
  if (sys.includes('estimate weekly worship attendance')) {
    const hasNumbers = r() > 0.4;
    const mid = 80 + Math.floor(r() * 600);
    const tierConf = hasNumbers ? conf(58, 88) : conf(25, 45);
    return {
      attendance_estimate: hasNumbers ? mid : null,
      attendance_min: hasNumbers ? Math.round(mid * 0.7) : null,
      attendance_max: hasNumbers ? Math.round(mid * 1.4) : null,
      attendance_confidence: tierConf,
      attendance_confidence_tier: tierConf >= 75 ? 'High' : tierConf >= 55 ? 'Medium' : tierConf >= 35 ? 'Low' : 'Very Low',
      staff_count: r() > 0.6 ? 2 + Math.floor(r() * 8) : null,
      campus_count: 1,
      weekend_services_count: 2,
      reasoning: hasNumbers
        ? 'Two weekend services with ~250-seat auditorium imply a moderate range.'
        : 'No published numbers; only indirect signals, so a broad low-confidence range.',
      evidence: [{
        field_name: 'weekend_services_count',
        proposed_value: '2',
        evidence_text: 'Homepage lists two Sunday services.',
        source_url: `https://www.${slug(name)}.org`,
        confidence_score: 80,
      }],
    };
  }
  // multiplication
  const s = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  return {
    church_planting_activity: s(10, 70),
    disciple_making: s(40, 90),
    leadership_development: s(30, 85),
    residency_internship: s(0, 60),
    mission_sending: s(40, 90),
    kingdom_collaboration: s(30, 80),
    innovation: s(20, 75),
    multiplication_orientation: s(25, 80),
    digital_reach: s(35, 85),
    explanation: `${name} shows discipleship pathways and mission emphasis; planting signals are moderate.`,
    evidence: [{
      field_name: 'multiplication',
      proposed_value: 'moderate',
      evidence_text: 'Site references discipleship pathway, missions, and leadership development.',
      source_url: `https://www.${slug(name)}.org`,
      confidence_score: 70,
    }],
  };
}

async function main() {
  rmSync(DB_PATH, { force: true });
  const store = new JsonStore(DB_PATH);

  console.log('\n=== 1) Import 5 churches from the real spreadsheet ===');
  const summary = await importSpreadsheet(store, { filePath: SEED_XLSX, limit: 5 });
  console.log(`Imported ${summary.imported}, detected columns:`, summary.detectedColumns);

  const ctx: AgentContext = {
    store,
    llm: new MockLlmProvider(mockResponder),
    research: new MockResearch(),
  };

  console.log('\n=== 2) Enrich each church (verify + contact + denom + size + score) ===');
  const all = await store.listChurches({});
  for (const c of all) {
    await enrichChurch(ctx, c.id);
  }

  console.log('\n=== 3) Results ===');
  const enriched = await store.listChurches({});
  for (const c of enriched) {
    console.log(
      `\n• ${c.name} (${c.city}, ${c.state})\n` +
        `    status=${c.active_status} website=${c.website_verified ?? '—'}\n` +
        `    denom=${c.denomination ?? '—'} pastor=${c.lead_pastor ?? '—'} email=${c.email_verified ?? '—'}\n` +
        `    attendance=${c.attendance_estimate ?? '—'} [${c.attendance_min ?? '?'}–${c.attendance_max ?? '?'}] ` +
        `tier=${c.attendance_confidence_tier ?? '—'}\n` +
        `    influence=${c.influence_score} mmc_fit=${c.mmc_fit_score} multiplication=${c.multiplication_score}`,
    );
  }

  console.log('\n=== 4) Review queue (confidence 60-84) ===');
  const pending = await store.listReviewQueue('pending');
  for (const item of pending) {
    console.log(`    [${item.confidence_score}] ${item.field_name}: "${item.current_value ?? '—'}" -> "${item.proposed_value}"`);
  }
  await processReviewQueue(store);

  console.log('\n=== 5) Export ===');
  await exportResults(store, { outPath: 'data/output/sample_output.json', format: 'json' });
  await exportResults(store, { outPath: 'data/output/sample_output.csv', format: 'csv' });
  console.log('\nDemo complete. See data/output/.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
