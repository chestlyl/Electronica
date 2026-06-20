import type { SourceFinding } from './dossier.js';
import type { EvidenceAccessLevel } from '../types.js';

export interface Fact {
  value: string | number | boolean;
  confidence: number;
  evidence: string;
  source_url: string;
  access_level: EvidenceAccessLevel;
}
export type Facts = Record<string, Fact>;

const CURRENT_YEAR = new Date().getFullYear();
const NAME = `([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+)`;
const PHONE = /\(?\b\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/;
const NUMWORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function num(token: string): number | null {
  const t = token.toLowerCase();
  if (t in NUMWORD) return NUMWORD[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

// ── individual extractors (return {value, confidence, ev} or null) ──────────
function foundedYear(text: string): { year: number; confidence: number; ev: string } | null {
  const explicit = text.match(/\b(?:began|founded|established|planted|started|est\.?|since)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i);
  if (explicit) {
    const y = parseInt(explicit[1], 10);
    if (y > 1800 && y <= CURRENT_YEAR) return { year: y, confidence: 70, ev: explicit[0] };
  }
  // anniversary: "celebrated 40 years" + a nearby year → founded = year - N
  const anniv = text.match(/celebrat\w*\s+(\d{1,3})\s+years/i) || text.match(/(\d{1,3})(?:th|st|nd|rd)?\s+anniversary/i);
  const yearM = text.match(/\bin\s+((?:19|20)\d{2})\b/i) || text.match(/\b((?:19|20)\d{2})\b/);
  if (anniv && yearM) {
    const n = parseInt(anniv[1], 10);
    const y = parseInt(yearM[1], 10) - n;
    if (n > 1 && n < 200 && y > 1800 && y <= CURRENT_YEAR) return { year: y, confidence: 64, ev: `${anniv[0]} (${yearM[0]})` };
  }
  return null;
}

function campus(text: string): { count: number | null; multi: boolean | null; confidence: number; ev: string } | null {
  const explicit = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:campuses|locations|sites)\b/i);
  if (explicit) {
    const c = num(explicit[1]);
    if (c != null) return { count: c, multi: c > 1, confidence: 65, ev: explicit[0] };
  }
  if (/\b(?:one|single)\s+(?:location|campus|site)\b/i.test(text)) return { count: 1, multi: false, confidence: 55, ev: 'single location' };
  if (/\bmulti-?site\b|\ball (?:our )?(?:campuses|locations)\b|\bother locations\b|\bcampus pastor\b/i.test(text)) return { count: null, multi: true, confidence: 55, ev: 'multisite language' };
  return null;
}

function staffCount(text: string): { count: number; confidence: number; ev: string } | null {
  const m = text.match(/\bteam of\s+(\d+)\b/i) || text.match(/\b(\d+)\s+(?:full-?time\s+)?(?:staff|team members|employees)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 2000) return { count: n, confidence: 58, ev: m[0] };
  }
  return null;
}

function giving(text: string, url: string): { confidence: number; ev: string; provider: string | null } | null {
  const hay = `${text} ${url}`.toLowerCase();
  const present = /\b(give online|online giving|give now|donate|giving|ways to give)\b/.test(hay) || /\/give|\/giving|\/donate/.test(url);
  if (!present) return null;
  const provider =
    /pushpay/.test(hay) ? 'Pushpay'
    : /tithe\.?ly|tithely/.test(hay) ? 'Tithe.ly'
    : /subsplash/.test(hay) ? 'Subsplash'
    : /givelify/.test(hay) ? 'Givelify'
    : /easytithe/.test(hay) ? 'EasyTithe'
    : /planning\s?center|churchcenter/.test(hay) ? 'Planning Center Giving'
    : null;
  return { confidence: 60, ev: 'online giving referenced', provider };
}

function appInfo(text: string, url: string): { status: string; provider: string | null; confidence: number; ev: string } | null {
  const hay = `${text} ${url}`.toLowerCase();
  const storeLink = /apps\.apple\.com|play\.google\.com\/store\/apps/.test(hay);
  const appWord = /\b(our|the)\s+(mobile\s+)?app\b|download our app/.test(hay);
  if (storeLink || appWord) {
    const provider =
      /subsplash|thechurchapp/.test(hay) ? 'Subsplash'
      : /churchcenter|planning\s?center/.test(hay) ? 'Church Center'
      : /tithe\.?ly/.test(hay) ? 'Tithe.ly'
      : /pushpay/.test(hay) ? 'Pushpay' : null;
    return { status: 'active', provider, confidence: storeLink ? 70 : 55, ev: 'app reference' };
  }
  if (/\bno (?:mobile )?app\b/.test(hay)) return { status: 'none_found', provider: null, confidence: 55, ev: 'no app stated' };
  return null;
}

function findRole(text: string, roleSource: string): { name: string; ev: string } | null {
  const patterns = [
    new RegExp(`${NAME}\\s+(?:is\\s+(?:the|our)\\s+|serves as\\s+(?:the|our)\\s+)?${roleSource}`, 'i'),
    new RegExp(`${roleSource}[\\s:,\\-–|]+${NAME}`, 'i'),
    new RegExp(`${NAME}[\\s,\\-–|]+(?:${roleSource})`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { name: m[1].trim(), ev: m[0].slice(0, 80) };
  }
  return null;
}

function officeEmail(text: string): { value: string; confidence: number; ev: string } | null {
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (!emails) return null;
  const office = emails.find((e) => /^(info|connect|hello|office|contact|admin|church|welcome)@/i.test(e));
  if (office) return { value: office, confidence: 60, ev: office };
  return { value: emails[0], confidence: 45, ev: emails[0] };
}

const ROLE_RE: { field: string; source: string }[] = [
  { field: 'lead_pastor', source: `(?:lead|senior)\\s+pastor` },
  { field: 'executive_pastor', source: `executive\\s+pastor` },
  { field: 'operations_leader', source: `(?:director of operations|operations\\s+(?:director|pastor|manager|lead))` },
  { field: 'communications_leader', source: `(?:communications|comms|creative|media)\\s+(?:director|pastor|lead|manager|coordinator)` },
];

/**
 * Deterministic extraction over the gathered evidence. Each fact records the
 * source URL + access level so the dossier caps its confidence accordingly.
 * The best (reliability × confidence) value per field wins. Emails are only
 * recorded if they literally appear in the text (never invented).
 */
export function extractFacts(findings: SourceFinding[]): Facts {
  const best: Record<string, { fact: Fact; score: number }> = {};
  const consider = (f: SourceFinding, field: string, value: Fact['value'] | null, confidence: number, evidence: string) => {
    if (value === null || value === undefined || value === '') return;
    const score = f.reliability * confidence;
    if (!best[field] || score > best[field].score) {
      best[field] = { fact: { value, confidence, evidence: evidence.slice(0, 160), source_url: f.url, access_level: f.accessLevel }, score };
    }
  };

  for (const f of findings) {
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const fy = foundedYear(text);
    if (fy) { consider(f, 'founded_year', fy.year, fy.confidence, fy.ev); consider(f, 'years_active', CURRENT_YEAR - fy.year, fy.confidence, fy.ev); }

    const cp = campus(text);
    if (cp) { if (cp.count != null) consider(f, 'campus_count', cp.count, cp.confidence, cp.ev); if (cp.multi != null) consider(f, 'multi_site', cp.multi, cp.confidence, cp.ev); }

    const sc = staffCount(text);
    if (sc) consider(f, 'staff_count', sc.count, sc.confidence, sc.ev);

    const gv = giving(text, f.url);
    if (gv) { consider(f, 'online_giving_present', true, gv.confidence, gv.ev); if (gv.provider) consider(f, 'giving_provider', gv.provider, 55, gv.ev); }

    const ap = appInfo(text, f.url);
    if (ap) { consider(f, 'app_status', ap.status, ap.confidence, ap.ev); if (ap.provider) consider(f, 'app_provider', ap.provider, ap.confidence, ap.ev); }

    for (const { field, source } of ROLE_RE) {
      const r = findRole(text, source);
      if (r) consider(f, field, r.name, 55, r.ev);
    }
    const em = officeEmail(text);
    if (em) consider(f, 'office_email', em.value, em.confidence, em.ev);
    const ph = text.match(PHONE);
    if (ph) consider(f, 'office_phone', ph[0], 55, text.slice(0, 120));
  }

  const out: Facts = {};
  for (const [k, v] of Object.entries(best)) out[k] = v.fact;
  return out;
}
