import { hostOf } from './emailMap.js';
import { logger } from '../lib/logger.js';
import type { SearchResult } from './types.js';

/**
 * Authoritative reported-attendance source — Outreach 100 + the Hartford
 * Institute megachurch database. These publish ACTUAL weekend-attendance figures
 * for large churches, so a hit here is a REPORTED number that overrides the
 * staff-pattern inference (which systematically under-sizes megachurches like
 * Grace and Cross Point). Self-limiting: both lists only cover ~2,000+ churches,
 * so smaller churches simply get no hit and fall back to pattern inference.
 *
 * Network lives in the injected `search` fn so the parser is unit-testable offline.
 */

export interface ReportedAttendance {
  value: number;
  source: string;             // 'Outreach 100' | 'Hartford megachurch database'
  year: number | null;
  rank: number | null;
  evidence: string;
  source_url: string;
  confidence: number;
}

const AUTH_HOST = /outreach100\.com|outreachmagazine\.com|hartfordinstitute|hartfordinternational|hartsem|hirr\./i;
const AUTH_TEXT = /outreach\s*100|outreach\s*magazine|hartford\s+(?:institute|seminary|megachurch)|megachurch\s+database/i;
const STOP = new Set(['the', 'church', 'churches', 'community', 'of', 'and', 'a', 'an', 'at', 'chapel', 'fellowship']);

function attendanceNumber(text: string): number | null {
  const pats = [
    /\battendance[^0-9]{0,24}([\d,]{4,7})\b/i,
    /\b([\d,]{4,7})\s*(?:in\s+)?(?:weekly\s+)?attendance\b/i,
    /\baverages?\s+(?:weekly\s+|weekend\s+)?(?:attendance\s+(?:of\s+)?)?([\d,]{4,7})\b/i,
    /#\s*\d+[^0-9]{0,30}?([\d,]{4,7})\b/,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) { const n = parseInt(m[1].replace(/,/g, ''), 10); if (n >= 1000 && n <= 200000) return n; }
  }
  return null;
}
const yearOf = (t: string): number | null => { const m = t.match(/\b(20[0-2]\d)\b/); return m ? parseInt(m[1], 10) : null; };
const rankOf = (t: string): number | null => { const m = t.match(/#\s*(\d{1,3})\b/); return m ? parseInt(m[1], 10) : null; };
const nameTokens = (name: string): string[] =>
  name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));

/** Parse the best authoritative attendance figure out of a set of search results. */
export function parseAuthoritativeAttendance(results: SearchResult[], churchName: string): ReportedAttendance | null {
  const toks = nameTokens(churchName);
  const hits: ReportedAttendance[] = [];
  for (const r of results) {
    const text = `${r.title ?? ''} ${r.snippet ?? ''}`;
    if (!AUTH_HOST.test(hostOf(r.url)) && !AUTH_TEXT.test(text)) continue;
    // wrong-church guard: at least one distinctive name token must appear
    if (toks.length && !toks.some((t) => text.toLowerCase().includes(t))) continue;
    const value = attendanceNumber(text);
    if (value == null) continue;
    const source = /hartford|hirr|hartsem/i.test(hostOf(r.url) + ' ' + text) ? 'Hartford megachurch database' : 'Outreach 100';
    const year = yearOf(text), rank = rankOf(text);
    hits.push({
      value, source, year, rank, source_url: r.url, confidence: 82,
      evidence: `${source}${rank ? ` #${rank}` : ''}${year ? ` (${year})` : ''}: ${value.toLocaleString()} reported attendance`,
    });
  }
  // The lists report TOTAL weekly attendance — prefer the largest credible figure.
  hits.sort((a, b) => b.value - a.value);
  return hits[0] ?? null;
}

export type SearchFn = (q: string, opts?: { limit?: number }) => Promise<{ results: SearchResult[] }>;

/** Look up a church's published attendance via Outreach 100 / Hartford. Best-effort. */
export async function lookupReportedAttendance(name: string, state: string | null, search: SearchFn): Promise<ReportedAttendance | null> {
  const loc = state ? ` ${state}` : '';
  const queries = [`${name}${loc} Outreach 100 attendance`, `${name}${loc} Hartford Institute megachurch attendance`];
  const debug = process.env.PROSPECT_DEBUG === '1' || process.env.ATTENDANCE_DEBUG === '1';
  const all: SearchResult[] = [];
  for (const q of queries) {
    try {
      const { results } = await search(q, { limit: 10 });
      all.push(...results);
      if (debug) {
        logger.info(`  [ATTENDANCE_DEBUG] query "${q}" → ${results.length} results`);
        for (const r of results.slice(0, 6)) logger.info(`    [${hostOf(r.url)}] ${(r.title ?? '').slice(0, 70)} :: ${(r.snippet ?? '').slice(0, 90)}`);
      }
    } catch (e) { if (debug) logger.info(`  [ATTENDANCE_DEBUG] query "${q}" failed: ${(e as Error).message}`); }
  }
  const parsed = parseAuthoritativeAttendance(all, name);
  if (debug) logger.info(`  [ATTENDANCE_DEBUG] parser → ${parsed ? `${parsed.value} (${parsed.source})` : 'no authoritative figure matched'} from ${all.length} total results`);
  return parsed;
}
