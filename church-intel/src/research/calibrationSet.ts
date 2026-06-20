import { readFileSync } from 'node:fs';
import { capForAccess } from './dossier.js';
import { toolFieldsFromBuild, type Cell, type FieldMap } from './calibration.js';
import type { DossierBuild, ResearchTarget } from './researchAgent.js';
import type { LinkDiagnostic } from './types.js';

export interface CalibrationEntry {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  url?: string | null;
}

export function loadCalibrationSet(path: string): CalibrationEntry[] {
  return JSON.parse(readFileSync(path, 'utf8')) as CalibrationEntry[];
}

/** Map the internal lifecycle enum to the calibration-report vocabulary. */
export function lifecycleDisplay(stage: string | null | undefined): string {
  switch (stage) {
    case 'plant': return 'church_plant';
    case 'relaunch_revitalization': return 'revitalizing';
    case 'growing': return 'growing';
    case 'established': return 'established';
    case 'plateaued': return 'plateaued';
    case 'declining': return 'declining';
    default: return stage ?? 'unknown';
    // note: 'relaunching' and 'reverting' are not separately detectable yet.
  }
}

function num(c: Cell | undefined): number | null {
  if (!c || c.value == null) return null;
  if (typeof c.value === 'number') return c.value;
  const n = parseFloat(String(c.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface Derived {
  value: string;
  confidence: number;
  evidence: string;
}

/**
 * Report-only church archetype, derived from existing dossier fields
 * (attendance, campuses, lifecycle, digital maturity). NOT a persisted column or
 * enrichment score — purely a calibration annotation.
 */
export function deriveArchetype(fields: FieldMap, accessLevel: string): Derived {
  const att = num(fields.avg_weekly_attendance);
  const online = num(fields.online_attendance_estimate);
  const campuses = num(fields.campus_count);
  const digital = num(fields.digital_maturity_score) ?? 0;
  const growth = num(fields.growth_orientation_score) ?? 0;
  const stage = String(fields.lifecycle_stage?.value ?? '');
  const cap = capForAccess(accessLevel as any);

  const ev: string[] = [];
  if (att != null) ev.push(`attendance≈${att}`);
  if (campuses != null) ev.push(`campuses=${campuses}`);
  if (stage) ev.push(`lifecycle=${stage}`);
  ev.push(`digital=${digital}`, `growth=${growth}`);

  let value = 'Unclassified';
  if (stage === 'relaunch_revitalization') value = 'Revitalization Church';
  else if (online != null && att != null && att > 0 && online >= 2 * att && digital >= 70) value = 'Influence Platform';
  else if (campuses != null && campuses >= 2) value = 'Multi-Campus Church';
  else if (att != null && att >= 2000) value = (stage === 'plateaued' || stage === 'declining') ? 'Plateaued Mega Church' : (growth >= 60 ? 'Growth Church' : 'Healthy Regional Church');
  else if (att != null && att >= 500) value = growth >= 60 ? 'Growth Church' : (stage === 'plateaued' || stage === 'declining' ? 'Institutional Church' : 'Healthy Regional Church');
  else if (stage === 'plant' || (att != null && att < 200 && growth >= 55)) value = 'Church Plant';
  else if (att != null && att < 500) value = stage === 'declining' ? 'Reverting Church' : 'Legacy Church';

  // Fallback: classify from lifecycle alone when size is unknown, so a church with
  // a clear lifecycle is not left "Unclassified".
  if (value === 'Unclassified') {
    if (stage === 'plant') value = 'Church Plant';
    else if (stage === 'growing') value = 'Growth Church';
    else if (stage === 'plateaued') value = 'Institutional Church';
    else if (stage === 'declining') value = 'Reverting Church';
    else if (stage === 'established') value = 'Healthy Regional Church';
  }

  // Confidence: anchored to attendance/lifecycle availability, capped by access.
  let conf = 30;
  if (att != null) conf += 20;
  if (campuses != null) conf += 10;
  if (stage) conf += 10;
  return { value, confidence: Math.min(conf, cap), evidence: ev.join(', ') };
}

/** Report-only contactability score: weighted completeness of relationship data. */
export function deriveContactability(build: DossierBuild, fields: FieldMap, accessLevel: string): Derived {
  const has = (k: string) => fields[k]?.value != null && fields[k]?.value !== '';
  const cap = capForAccess(accessLevel as any);
  const parts: { key: string; w: number; label: string }[] = [
    { key: 'lead_pastor', w: 30, label: 'lead pastor' },
    { key: 'executive_pastor', w: 15, label: 'exec pastor' },
    { key: 'operations_leader', w: 10, label: 'operations' },
    { key: 'communications_leader', w: 10, label: 'communications' },
    { key: 'office_email', w: 20, label: 'email' },
    { key: 'office_phone', w: 15, label: 'phone' },
  ];
  let score = 0;
  const found: string[] = [];
  const missing: string[] = [];
  for (const p of parts) {
    if (has(p.key)) { score += p.w; found.push(p.label); } else missing.push(p.label);
  }
  const evidence = `found: ${found.join(', ') || 'none'}${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`;
  // Confidence reflects how the contacts were sourced (capped by access level).
  return { value: String(score), confidence: Math.min(60, cap), evidence };
}

export interface CalibrationConflict {
  field_name: string; value_a: string | null; value_b: string | null; recommended_value: string | null; confidence: number | null;
}

/** Serializable per-church calibration row (cached as <id>.json by calibrate-run). */
export interface CalibrationRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  officialSite: string | null;
  identityVerdict: string;
  identity_confidence: number;
  contaminationFlags: string[];
  accessLevel: string;
  research_confidence: number | null;
  fields: FieldMap;
  summaries: { identity: string; digital: string; staff: string; growth: string; lifecycle: string; research: string };
  conflicts: CalibrationConflict[];
  archetype: Derived;
  contactability: Derived;
  lifecycle: { value: string; confidence: number; evidence: string };
  crawl: { officialDomFetched: boolean; renderedDomUsed: boolean; crawlMethod: string; rawTextLength: number; renderedTextLength: number; renderedGainRatio: number; links: LinkDiagnostic[] };
  generatedAt: string;
}

export function rowFromBuild(entry: CalibrationEntry, build: DossierBuild): CalibrationRow {
  const target: ResearchTarget = { name: entry.name, city: entry.city, state: entry.state, originalWebsite: entry.url ?? null, alternateName: null };
  const fields = toolFieldsFromBuild(target, build);
  const s = build.synthesis;
  const lifecycleConf = build.fieldEstimates.find((f) => f.field_name === 'lifecycle_stage')?.confidence ?? build.dossier.research_confidence ?? 0;
  return {
    id: entry.id, name: entry.name, city: entry.city, state: entry.state,
    officialSite: build.officialSite,
    identityVerdict: build.identity.identityVerdict,
    identity_confidence: build.identity.identity_confidence,
    contaminationFlags: build.contamination,
    accessLevel: build.accessLevel,
    research_confidence: build.dossier.research_confidence,
    fields,
    summaries: {
      identity: s.identity_summary, digital: s.digital_summary, staff: s.staff_summary,
      growth: s.growth_summary, lifecycle: s.lifecycle_summary, research: s.research_summary,
    },
    conflicts: build.conflicts.map((c) => ({ field_name: c.field_name, value_a: c.value_a, value_b: c.value_b, recommended_value: c.recommended_value, confidence: c.confidence })),
    archetype: deriveArchetype(fields, build.accessLevel),
    contactability: deriveContactability(build, fields, build.accessLevel),
    lifecycle: { value: lifecycleDisplay(String(s.lifecycle_stage)), confidence: lifecycleConf, evidence: s.lifecycle_summary },
    crawl: build.crawl,
    generatedAt: new Date().toISOString(),
  };
}
