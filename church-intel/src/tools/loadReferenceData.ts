/**
 * Load the extracted reference data (data/reference/*.json) into Supabase. Full
 * REPLACE per table — the workbooks are the single source of truth, so each run
 * truncates and re-inserts (idempotent). Run AFTER `npm run ingest:reference`
 * and after applying supabase/migrations/0004_reference_data.sql.
 *
 *   npm run load:reference
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

const DIR = 'data/reference';
const TABLES: { table: string; file: string }[] = [
  { table: 'denominations', file: 'denominations.json' },
  { table: 'denomination_state_stats', file: 'denomination_state_stats.json' },
  { table: 'attendance_bands', file: 'attendance_bands.json' },
  { table: 'network_contacts', file: 'network_contacts.json' },
];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main(): Promise<void> {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    logger.error('Supabase is not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env, then re-run.');
    process.exit(1);
  }
  const db = supabase();
  for (const { table, file } of TABLES) {
    const path = join(DIR, file);
    if (!existsSync(path)) { logger.warn(`skip ${table}: ${path} not found (run npm run ingest:reference first)`); continue; }
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    // Full replace: delete all, then insert.
    const del = await db.from(table).delete().not('id', 'is', null);
    if (del.error) { logger.error(`${table}: delete failed — ${del.error.message}`); continue; }
    let inserted = 0;
    for (const part of chunk(rows, 500)) {
      const { error } = await db.from(table).insert(part);
      if (error) { logger.error(`${table}: insert failed — ${error.message}`); break; }
      inserted += part.length;
    }
    logger.info(`${table}: loaded ${inserted}/${rows.length} rows`);
  }
  logger.info('Reference data load complete.');
}

main().catch((e) => { logger.error(String(e)); process.exit(1); });
