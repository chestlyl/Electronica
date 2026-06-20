import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as XLSX from 'xlsx';
import { logger } from './lib/logger.js';
import type { Store } from './db/store.js';
import type { ChurchFilter } from './types.js';

export interface ExportOptions {
  outPath: string;
  format?: 'xlsx' | 'csv' | 'json';
  filter?: ChurchFilter;
}

/** export-results: write the enriched churches table to xlsx/csv/json. */
export async function exportResults(store: Store, opts: ExportOptions): Promise<number> {
  const fmt = opts.format ?? (opts.outPath.endsWith('.csv') ? 'csv' : opts.outPath.endsWith('.json') ? 'json' : 'xlsx');
  const churches = await store.listChurches({ ...(opts.filter ?? {}), limit: undefined, offset: undefined });

  mkdirSync(dirname(opts.outPath), { recursive: true });

  if (fmt === 'json') {
    writeFileSync(opts.outPath, JSON.stringify(churches, null, 2));
  } else {
    const ws = XLSX.utils.json_to_sheet(churches);
    if (fmt === 'csv') {
      writeFileSync(opts.outPath, XLSX.utils.sheet_to_csv(ws));
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'churches');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      writeFileSync(opts.outPath, buf);
    }
  }
  logger.info(`Exported ${churches.length} churches -> ${opts.outPath} (${fmt})`);
  return churches.length;
}
