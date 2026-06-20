#!/usr/bin/env node
import { Command } from 'commander';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { SupabaseStore } from './db/supabase.js';
import { createLiveContext } from './context.js';
import { importSpreadsheet } from './importer/importSpreadsheet.js';
import { verifyChurch, enrichChurch, scoreChurch } from './agents/index.js';
import { processReviewQueue, setReviewStatus } from './review.js';
import { exportResults } from './export.js';
import { runDoctor, printDoctor } from './doctor.js';
import { discoverWebsite } from './research/discovery.js';
import { buildDossier, type DossierBuild, type ResearchTarget } from './research/researchAgent.js';
import { renderDossierMarkdown } from './research/dossierMarkdown.js';
import { extractAltName } from './agents/index.js';
import { loadCalibrationSet, rowFromBuild, type CalibrationRow } from './research/calibrationSet.js';
import { renderCalibrationReport } from './research/calibrationReport.js';
import { loadFieldMap, FIELDS } from './research/calibration.js';
import type { Store } from './db/store.js';
import type { Church } from './types.js';
import type { ChurchFilter, ReviewStatus } from './types.js';

const program = new Command();
program
  .name('church-intel')
  .description('Church Intelligence Platform — verify, enrich, and score churches')
  .version('1.0.0');

// ── import-spreadsheet ─────────────────────────────────────────────────────
program
  .command('import-spreadsheet')
  .description('Import a church roster spreadsheet into Supabase')
  .option('-f, --file <path>', 'path to .xlsx/.csv', 'data/Church_Data_v1.xlsx')
  .option('--limit <n>', 'only import the first N rows', (v) => parseInt(v, 10))
  .option('--sheet <name>', 'sheet name (defaults to first)')
  .action(async (opts) => {
    const store = new SupabaseStore();
    const summary = await importSpreadsheet(store, {
      filePath: opts.file,
      limit: opts.limit,
      sheet: opts.sheet,
    });
    console.log(JSON.stringify(summary, null, 2));
  });

// ── doctor ─────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check whether the system is ready for real enrichment')
  .action(async () => {
    const checks = await runDoctor();
    printDoctor(checks);
  });

// ── discover-church ────────────────────────────────────────────────────────
program
  .command('discover-church')
  .description('Test website discovery only (no crawl, no Claude, no DB writes)')
  .requiredOption('--id <id>', 'church id or original_row_id')
  .action(async (opts) => {
    const store = new SupabaseStore();
    const id = await resolveId(store, opts.id);
    const c = await store.getChurch(id);
    if (!c) throw new Error(`church ${id} not found`);
    const altName = extractAltName(c.notes);
    const result = await discoverWebsite({
      name: c.name ?? '',
      city: c.city,
      state: c.state,
      originalWebsite: c.website_original,
      originalPhone: c.phone_original,
      originalEmail: c.email_original,
      alternateName: altName,
    });

    console.log(`\nChurch:  ${c.name} (${c.city ?? ''}, ${c.state ?? ''})  [${c.original_row_id}]`);
    console.log(`Seed website: ${c.website_original ?? '—'}   alt name: ${altName ?? '—'}`);
    console.log(`Query:   ${result.query}`);
    if (result.altQuery) console.log(`Alt q:   ${result.altQuery}`);

    console.log('\nSearch providers:');
    for (const d of result.searchDiagnostics) {
      console.log(
        `  ${d.ok ? 'ok ' : '-- '} ${d.provider.padEnd(18)} status=${String(d.status).padEnd(4)} results=${d.resultCount}${d.note ? `  (${d.note})` : ''}`,
      );
    }

    console.log('\nCandidates (ranked by identity confidence):');
    if (result.candidates.length === 0) console.log('  (none)');
    for (const cand of result.candidates) {
      console.log(
        `  ${cand.accepted ? '✓' : '✗'} [id ${String(cand.identity_confidence).padStart(3)}] ${cand.identityVerdict.padEnd(11)} ${cand.source}/${cand.kind}${cand.provider ? `(${cand.provider})` : ''} ${cand.url}`,
      );
      console.log(
        `        name=${cand.nameMatch}${cand.nameFull ? '(full)' : ''} city=${cand.cityStatus} reachable=${cand.reachable} churchLike=${cand.churchLike} parked=${cand.parked}`,
      );
      console.log(`        ↳ ${cand.reason}`);
    }

    const verdict = result.officialSite ? 'TRUE MATCH' : result.identityVerdict === 'uncertain' ? 'UNCERTAIN → NO MATCH' : 'NO MATCH';
    console.log(`\n→ ${verdict}: ${result.officialSite ?? '(none)'}   via ${result.method}`);
    console.log(`  identity_confidence=${result.identity_confidence}`);
    console.log(`  ${result.note}\n`);
  });

// ── discovery-report ───────────────────────────────────────────────────────
program
  .command('discovery-report')
  .description('Write a markdown identity-evaluation report for several churches')
  .option('--ids <list>', 'comma-separated ids/row-ids', 'row-2,row-3,row-4')
  .option('-o, --out <path>', 'output markdown file', 'data/output/discovery_report.md')
  .action(async (opts) => {
    const store = new SupabaseStore();
    const ids: string[] = opts.ids.split(',').map((s: string) => s.trim()).filter(Boolean);
    const md = await buildDiscoveryReport(store, ids);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, md);
    console.log(md);
    console.log(`\nWrote ${opts.out}`);
  });

// ── research-church / research-dossier ─────────────────────────────────────
program
  .command('research-church')
  .description('Build a multi-source research dossier (ad-hoc; prints, no DB write)')
  .requiredOption('--url <url>', 'official website (or best guess)')
  .requiredOption('--name <name>', 'church name')
  .option('--city <city>', 'city')
  .option('--state <state>', 'state')
  .option('-o, --out <path>', 'write the dossier markdown to this path')
  .action(async (opts) => {
    const ctx = createLiveContext();
    try {
      const target: ResearchTarget = { name: opts.name, city: opts.city ?? null, state: opts.state ?? null, originalWebsite: opts.url, alternateName: null };
      const build = await buildDossier(target, ctx);
      await emitDossier(target, build, opts.out);
    } finally {
      await ctx.close();
    }
  });

program
  .command('research-dossier')
  .description('Research a stored church (--id) or ad-hoc (--url); persists with --id or --save')
  .option('--id <id>', 'church id or original_row_id')
  .option('--url <url>', 'official website (ad-hoc)')
  .option('--name <name>', 'church name (ad-hoc)')
  .option('--city <city>', 'city (ad-hoc)')
  .option('--state <state>', 'state (ad-hoc)')
  .option('--save', 'persist the dossier even in ad-hoc mode')
  .option('-o, --out <path>', 'write the dossier markdown to this path')
  .action(async (opts) => {
    const ctx = createLiveContext();
    try {
      let target: ResearchTarget;
      let churchId: string | null = null;
      if (opts.id) {
        churchId = await resolveId(ctx.store, opts.id);
        const c = await ctx.store.getChurch(churchId);
        if (!c) throw new Error(`church ${churchId} not found`);
        target = { name: c.name ?? '', city: c.city, state: c.state, originalWebsite: c.website_original, alternateName: extractAltName(c.notes) };
      } else {
        if (!opts.url || !opts.name) throw new Error('Provide --id, or --url and --name for ad-hoc mode');
        target = { name: opts.name, city: opts.city ?? null, state: opts.state ?? null, originalWebsite: opts.url, alternateName: null };
      }
      const build = await buildDossier(target, ctx);
      await emitDossier(target, build, opts.out);
      if (churchId || opts.save) {
        if (!churchId && opts.save) churchId = await createAdhocChurch(ctx.store, target);
        if (churchId) {
          await persistDossier(ctx.store, churchId, build);
          console.log(`\nPersisted dossier + ${build.conflicts.length} conflict(s) + strategic fields for church ${churchId}.`);
        }
      }
    } finally {
      await ctx.close();
    }
  });

// ── research-calibrate ─────────────────────────────────────────────────────
program
  .command('research-calibrate')
  .description('Build a dossier and diff it vs the Claude baseline + ground truth')
  .option('--id <id>', 'church id or original_row_id')
  .option('--url <url>', 'official website (ad-hoc)')
  .option('--name <name>', 'church name (ad-hoc)')
  .option('--city <city>', 'city')
  .option('--state <state>', 'state')
  .requiredOption('--ground-truth <path>', 'ground-truth json (see docs/calibration/*.template.json)')
  .option('--baseline <path>', 'Claude baseline json', 'docs/calibration/claude_baseline_cornerstone.json')
  .option('-o, --out <path>', 'output markdown', 'data/output/calibration_report.md')
  .action(async (opts) => {
    const ctx = createLiveContext();
    try {
      let target: ResearchTarget;
      if (opts.id) {
        const id = await resolveId(ctx.store, opts.id);
        const c = await ctx.store.getChurch(id);
        if (!c) throw new Error(`church ${id} not found`);
        target = { name: c.name ?? '', city: c.city, state: c.state, originalWebsite: c.website_original, alternateName: extractAltName(c.notes) };
      } else {
        if (!opts.url || !opts.name) throw new Error('Provide --id, or --url and --name');
        target = { name: opts.name, city: opts.city ?? null, state: opts.state ?? null, originalWebsite: opts.url, alternateName: null };
      }
      const build = await buildDossier(target, ctx);
      const { compareCalibration, loadFieldMap, toolFieldsFromBuild } = await import('./research/calibration.js');
      const { renderCalibrationMarkdown } = await import('./research/calibrationMarkdown.js');
      const report = compareCalibration(
        toolFieldsFromBuild(target, build),
        loadFieldMap(opts.baseline),
        loadFieldMap(opts.groundTruth),
        build.accessLevel,
      );
      report.conflicts = build.conflicts.map((c) => ({ field: c.field_name, a: c.value_a ?? '', b: c.value_b ?? '', recommended: c.recommended_value ?? '', confidence: c.confidence }));
      const md = renderCalibrationMarkdown(target.name, report);
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, md);
      console.log(md);
      console.log(`\nWrote ${opts.out}`);
    } finally {
      await ctx.close();
    }
  });

// ── calibrate-run / calibrate-report / calibrate-template ──────────────────
const SET_DEFAULT = 'docs/calibration/calibration_set.json';
const CALIB_DIR = 'data/output/calibration';

program
  .command('calibrate-run')
  .description('Run research dossiers for the calibration set (live Claude/Playwright)')
  .option('--set <file>', 'calibration set json', SET_DEFAULT)
  .option('--id <id>', 'run only this calibration id')
  .option('--out <dir>', 'output directory', CALIB_DIR)
  .option('--no-save', 'do not persist to Supabase (files only)')
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler')
  .action(async (opts) => {
    const set = loadCalibrationSet(opts.set);
    const entries = opts.id ? set.filter((e) => e.id === opts.id) : set;
    if (!entries.length) throw new Error(`no calibration entries match ${opts.id ?? ''}`);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(opts.out, { recursive: true });
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    let totTok = 0, totCost = 0;
    try {
      for (const e of entries) {
        const target: ResearchTarget = { name: e.name, city: e.city, state: e.state, originalWebsite: e.url ?? null, alternateName: null };
        logger.info(`▶ calibrate: ${e.name} (${e.city}, ${e.state})`);
        try {
          const build = await buildDossier(target, ctx);
          totTok += build.tokens; totCost += build.cost;
          writeFileSync(`${opts.out}/${e.id}.md`, renderDossierMarkdown(target, build));
          writeFileSync(`${opts.out}/${e.id}.json`, JSON.stringify(rowFromBuild(e, build), null, 2));
          if (opts.save !== false) {
            try {
              const cid = await createAdhocChurch(ctx.store, target);
              await persistDossier(ctx.store, cid, build);
            } catch (err) {
              logger.warn(`  persist skipped: ${(err as Error).message}`);
            }
          }
          const row = rowFromBuild(e, build);
          logger.info(`  → ${row.officialSite ?? 'NO MATCH'} · archetype ${row.archetype.value} · access ${build.accessLevel} · tokens ${build.tokens}`);
        } catch (err) {
          logger.error(`  ${e.id} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      await ctx.close();
    }
    logger.info(`Calibration run: ${entries.length} churches · ${totTok} tokens · ~$${totCost.toFixed(2)} · files in ${opts.out}/`);
    console.log('Next: fill docs/calibration/expectations/*.json (optional), then `npm run cli -- calibrate-report`');
  });

program
  .command('calibrate-report')
  .description('Generate docs/CALIBRATION_REPORT.md from cached calibration runs')
  .option('--set <file>', 'calibration set json', SET_DEFAULT)
  .option('--dir <dir>', 'calibration run directory', CALIB_DIR)
  .option('-o, --out <file>', 'output markdown', 'docs/CALIBRATION_REPORT.md')
  .action(async (opts) => {
    const set = loadCalibrationSet(opts.set);
    const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const rows: CalibrationRow[] = [];
    for (const e of set) {
      const p = `${opts.dir}/${e.id}.json`;
      if (existsSync(p)) rows.push(JSON.parse(readFileSync(p, 'utf8')));
      else logger.warn(`missing ${p} — run calibrate-run first`);
    }
    if (!rows.length) throw new Error('no calibration rows found; run calibrate-run first');
    const expectations: Record<string, ReturnType<typeof loadFieldMap>> = {};
    for (const e of set) {
      const ep = `docs/calibration/expectations/${e.id}.json`;
      if (existsSync(ep)) expectations[e.id] = loadFieldMap(ep);
    }
    const md = renderCalibrationReport(rows, expectations);
    mkdirSync(dirname(opts.out) || '.', { recursive: true });
    writeFileSync(opts.out, md);
    console.log(`Wrote ${opts.out} (${rows.length} churches, ${Object.keys(expectations).length} with expectations)`);
  });

program
  .command('calibrate-template')
  .description('Scaffold blank expectations/<id>.json for the calibration set')
  .option('--set <file>', 'calibration set json', SET_DEFAULT)
  .action(async (opts) => {
    const set = loadCalibrationSet(opts.set);
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    mkdirSync('docs/calibration/expectations', { recursive: true });
    for (const e of set) {
      const p = `docs/calibration/expectations/${e.id}.json`;
      if (existsSync(p)) { console.log(`skip ${p} (exists)`); continue; }
      const obj: Record<string, unknown> = { _about: `Ground truth for ${e.name} (${e.city}, ${e.state}) — fill value for what you have verified.` };
      for (const f of FIELDS) obj[f.key] = { value: null, confidence: 100, source: '' };
      writeFileSync(p, JSON.stringify(obj, null, 2));
      console.log(`wrote ${p}`);
    }
  });

// ── verify-church / verify-batch ───────────────────────────────────────────
program
  .command('verify-church')
  .description('Verify a single church (active status + official website)')
  .requiredOption('--id <id>', 'church id (uuid) or original_row_id (e.g. row-12)')
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler (no browser)')
  .action(async (opts) => {
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    try {
      const id = await resolveId(ctx.store, opts.id);
      await verifyChurch(ctx, id);
    } finally {
      await ctx.close();
    }
  });

program
  .command('verify-batch')
  .description('Verify a batch of not-yet-checked churches')
  .option('--limit <n>', 'max churches', (v) => parseInt(v, 10), 10)
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler (no browser)')
  .action(async (opts) => {
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    try {
      const churches = await ctx.store.listChurches({ needsVerification: true, limit: opts.limit });
      logger.info(`Verifying ${churches.length} churches…`);
      for (const c of churches) await safeRun(() => verifyChurch(ctx, c.id));
    } finally {
      await ctx.close();
    }
  });

// ── enrich-church / enrich-batch ───────────────────────────────────────────
program
  .command('enrich-church')
  .description('Full enrichment (verify + contact + denomination + size + score)')
  .requiredOption('--id <id>', 'church id or original_row_id')
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler (no browser)')
  .action(async (opts) => {
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    try {
      const id = await resolveId(ctx.store, opts.id);
      await enrichChurch(ctx, id);
    } finally {
      await ctx.close();
    }
  });

program
  .command('enrich-batch')
  .description('Enrich a batch of churches')
  .option('--limit <n>', 'max churches', (v) => parseInt(v, 10), 10)
  .option('--missing-website', 'only churches missing a verified website')
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler (no browser)')
  .action(async (opts) => {
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    try {
      const filter: ChurchFilter = { limit: opts.limit };
      if (opts.missingWebsite) filter.missingWebsite = true;
      else filter.needsVerification = true;
      const churches = await ctx.store.listChurches(filter);
      logger.info(`Enriching ${churches.length} churches…`);
      for (const c of churches) await safeRun(() => enrichChurch(ctx, c.id));
    } finally {
      await ctx.close();
    }
  });

// ── score-church ───────────────────────────────────────────────────────────
program
  .command('score-church')
  .description('Compute influence / MMC fit / multiplication scores')
  .requiredOption('--id <id>', 'church id or original_row_id')
  .option('--fetch-fallback', 'force the plain-HTTP fetch crawler (no browser)')
  .action(async (opts) => {
    const ctx = createLiveContext({ forceFetch: opts.fetchFallback });
    try {
      const id = await resolveId(ctx.store, opts.id);
      await scoreChurch(ctx, id);
    } finally {
      await ctx.close();
    }
  });

// ── process-review-queue ───────────────────────────────────────────────────
program
  .command('process-review-queue')
  .description('Commit approved review items and report pending ones')
  .option('--approve <id>', 'approve and apply a specific review item')
  .option('--reject <id>', 'reject a specific review item')
  .option('--notes <text>', 'reviewer notes')
  .action(async (opts) => {
    const store = new SupabaseStore();
    if (opts.approve) await setReviewStatus(store, opts.approve, 'approved', opts.notes);
    if (opts.reject) await setReviewStatus(store, opts.reject, 'rejected', opts.notes);
    const summary = await processReviewQueue(store);
    console.log(JSON.stringify(summary, null, 2));
  });

// ── export-results ─────────────────────────────────────────────────────────
program
  .command('export-results')
  .description('Export enriched churches to xlsx/csv/json')
  .option('-o, --out <path>', 'output file', 'data/output/churches_export.xlsx')
  .option('--format <fmt>', 'xlsx | csv | json')
  .option('--min-mmc <n>', 'only churches with mmc_fit_score >= n', (v) => parseFloat(v))
  .option('--state <st>', 'filter by state')
  .action(async (opts) => {
    const store = new SupabaseStore();
    const filter: ChurchFilter = {};
    if (opts.minMmc !== undefined) filter.minMmcFit = opts.minMmc;
    if (opts.state) filter.state = opts.state;
    const n = await exportResults(store, { outPath: opts.out, format: opts.format, filter });
    console.log(`Exported ${n} rows to ${opts.out}`);
  });

// ── helpers ────────────────────────────────────────────────────────────────
async function resolveId(store: Store, idOrRow: string): Promise<string> {
  if (idOrRow.startsWith('row-')) {
    const c = await store.getChurchByRowId(idOrRow);
    if (!c) throw new Error(`No church with original_row_id "${idOrRow}"`);
    return c.id;
  }
  return idOrRow;
}

async function buildDiscoveryReport(store: Store, ids: string[]): Promise<string> {
  const lines: string[] = ['# Discovery evaluation report', ''];
  lines.push(`_Generated ${new Date().toISOString()}_`, '');
  for (const raw of ids) {
    let id: string;
    try {
      id = await resolveId(store, raw);
    } catch {
      lines.push(`## ${raw}\n\n- not found\n`);
      continue;
    }
    const c = await store.getChurch(id);
    if (!c) { lines.push(`## ${raw}\n\n- not found\n`); continue; }
    const altName = extractAltName(c.notes);
    const r = await discoverWebsite({
      name: c.name ?? '', city: c.city, state: c.state,
      originalWebsite: c.website_original, originalPhone: c.phone_original,
      originalEmail: c.email_original, alternateName: altName,
    });
    const verdict = r.officialSite ? '✅ TRUE MATCH' : r.identityVerdict === 'uncertain' ? '⚠️ UNCERTAIN → NO MATCH' : '🚫 NO MATCH';
    lines.push(`## ${c.original_row_id} — ${c.name ?? '(no name)'} (${c.city ?? ''}, ${c.state ?? ''})`, '');
    lines.push(`- Seed website: \`${c.website_original ?? '—'}\`  ·  alt name: \`${altName ?? '—'}\``);
    lines.push(`- Result: **${verdict}** → \`${r.officialSite ?? '(none)'}\`  ·  identity_confidence **${r.identity_confidence}**`);
    lines.push(`- ${r.note}`, '');
    lines.push('| ✓ | identity | verdict | source/kind | name | city | URL |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const cand of r.candidates.slice(0, 8)) {
      lines.push(
        `| ${cand.accepted ? '✓' : '✗'} | ${cand.identity_confidence} | ${cand.identityVerdict} | ${cand.source}/${cand.kind} | ${cand.nameMatch}${cand.nameFull ? '(full)' : ''} | ${cand.cityStatus} | ${cand.url} |`,
      );
    }
    lines.push('', '<details><summary>scoring detail</summary>', '');
    for (const cand of r.candidates.slice(0, 8)) lines.push(`- \`${cand.url}\` — ${cand.reason}`);
    lines.push('</details>', '');
  }
  return lines.join('\n');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'church';
}

async function emitDossier(target: ResearchTarget, build: DossierBuild, outPath?: string): Promise<void> {
  const md = renderDossierMarkdown(target, build);
  console.log(md);
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const out = outPath || `data/output/dossier_${slugify(target.name)}.md`;
  mkdirSync(dirname(out) || '.', { recursive: true });
  writeFileSync(out, md);
  console.log(`\nWrote ${out}  (tokens ${build.tokens}, ~$${build.cost.toFixed(4)})`);
}

async function persistDossier(store: Store, churchId: string, build: DossierBuild): Promise<void> {
  await store.upsertDossier({ ...build.dossier, church_id: churchId });
  for (const c of build.conflicts) await store.addConflict({ ...c, church_id: churchId });
  await store.updateChurch(churchId, build.strategic);
}

async function createAdhocChurch(store: Store, target: ResearchTarget): Promise<string> {
  const { id } = await store.upsertImportRecord({
    original_row_id: `adhoc-${slugify(target.name)}`,
    name: target.name, address: null, city: target.city, state: target.state,
    zip: null, country: 'United States', phone_original: null, email_original: null,
    website_original: target.originalWebsite, language: null, network_affiliation: null,
    notes: target.alternateName ? `Seed alt name: ${target.alternateName}` : null,
  });
  return id;
}

async function safeRun(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error((err as Error).message);
  }
}

program.parseAsync(process.argv).catch((err) => {
  logger.error(err?.message ?? String(err));
  process.exit(1);
});
