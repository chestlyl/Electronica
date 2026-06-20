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
import type { Store } from './db/store.js';
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
