import { randomUUID } from 'node:crypto';

/** Opaque, prefixed id (`job_…`, `church_…`, `dossier_…`). The prefix is purely
 *  for human/log readability — the value is treated as opaque across the seam. */
export function newId(prefix: 'job' | 'church' | 'dossier'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export const nowIso = (): string => new Date().toISOString();
