import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { logger } from '../lib/logger.js';
import type { Store } from '../db/store.js';
import { detectColumns, mapRow } from './columnMap.js';

export interface ImportSummary {
  filePath: string;
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  warnings: number;
  detectedColumns: Record<string, number>;
  durationMs: number;
}

export interface ImportOptions {
  filePath: string;
  limit?: number;
  sheet?: string;
}

/**
 * Read an .xlsx/.csv church roster, map columns, preserve originals, create
 * stable original_row_id values, de-dupe, and log a result summary.
 */
export async function importSpreadsheet(store: Store, opts: ImportOptions): Promise<ImportSummary> {
  const started = Date.now();
  if (!existsSync(opts.filePath)) {
    throw new Error(`Spreadsheet not found: ${opts.filePath}`);
  }

  const wb = XLSX.read(readFileSync(opts.filePath), { type: 'buffer', cellDates: true });
  const sheetName = opts.sheet ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(', ')}`);

  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false });
  if (rows.length < 2) throw new Error('Spreadsheet has no data rows');

  const headers = rows[0];
  const columnMap = detectColumns(headers);
  logger.info(`Detected columns: ${JSON.stringify(columnMap)}`);
  const required = ['name'];
  for (const r of required) {
    if (!(r in columnMap)) logger.warn(`Could not detect a "${r}" column — values will be null`);
  }

  let imported = 0;
  let skipped = 0;
  let warnings = 0;
  const dataRows = rows.slice(1);
  const max = opts.limit ? Math.min(opts.limit, dataRows.length) : dataRows.length;

  for (let i = 0; i < max; i++) {
    const { record, warnings: w } = mapRow(dataRows[i], columnMap, i + 1);
    if (w.length) warnings++;
    // Skip entirely empty rows.
    if (!record.name && !record.address && !record.phone_original && !record.email_original) {
      continue;
    }
    try {
      const res = await store.upsertImportRecord(record);
      if (res.inserted) imported++;
      else skipped++;
    } catch (err) {
      logger.error(`Row ${i + 1} (${record.original_row_id}) failed: ${(err as Error).message}`);
    }
    if ((imported + skipped) % 250 === 0 && imported + skipped > 0) {
      logger.info(`  …processed ${imported + skipped} rows`);
    }
  }

  const summary: ImportSummary = {
    filePath: opts.filePath,
    totalRows: dataRows.length,
    imported,
    skippedDuplicates: skipped,
    warnings,
    detectedColumns: columnMap,
    durationMs: Date.now() - started,
  };
  logger.info(
    `Import complete: ${imported} imported, ${skipped} duplicates skipped, ` +
      `${warnings} rows with warnings, in ${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  return summary;
}
