import { capForAccess } from './dossier.js';
import {
  type AttendanceFactor,
  type AttendanceSource,
  type Conclusion,
  type Interpretation,
  type NormalizedEvidence,
  type NormalizedRow,
} from './evidenceModel.js';
import type { Facts } from './extractors.js';
import type { Cell, FieldMap } from './calibration.js';
import type { ScoreConfidence } from './coverage.js';
import type { DossierSynthesis } from '../claude/dossierPrompt.js';
import type { EvidenceAccessLevel } from '../types.js';

/**
 * Layer 4 — Interpretation.
 *
 * THE ONLY layer that produces conclusions. It reasons exclusively from
 * NormalizedEvidence (+ the synthesis as a supporting opinion), never from raw
 * webpage text. Every conclusion references the normalized rows it rests on, so
 * report and enrich can consume the SAME Interpretation and never diverge.
 */

// ── report-only derivations (moved here from calibrationSet so conclusions live
//    in the interpretation layer; re-exported by calibrationSet for compat) ────
export interface Derived { value: string; confidence: number; evidence: string; }

function num(c: Cell | undefined): number | null {
  if (!c || c.value == null) return null;
  if (typeof c.value === 'number') return c.value;
  const n = parseFloat(String(c.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Multiplication / growth signals that distinguish a Growth church from a
 *  stable Legacy one even at modest or unknown size. */
export interface ArchetypeSignals { residency?: boolean; hiring?: boolean; multisite?: boolean; network?: boolean; school?: boolean; celebrity?: boolean }

/** Nationally-recognized "celebrity pastors" — their churches are a distinct
 *  category (Celebrity Church), separate from raw size. Extend as needed. */
export const CELEBRITY_PASTORS = [
  'steven furtick', 'michael todd', 'mike todd', 'td jakes', 't d jakes', 'andy stanley',
  'craig groeschel', 'mark driscoll', 'judah smith', 'rich wilkerson', 'joel osteen',
  'levi lusko', 'john gray', 'chad veach', 'louie giglio', 'jentezen franklin', 'greg laurie',
  'rick warren', 'erwin mcmanus', 'christine caine', 'sarah jakes roberts', 'toure roberts',
];
function normName(s: string): string { return s.toLowerCase().replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function isCelebrityPastor(names: string[]): boolean {
  const ns = names.map(normName);
  return ns.some((n) => CELEBRITY_PASTORS.some((c) => n.includes(c) || c.includes(n)));
}
const round25 = (n: number) => Math.round(n / 25) * 25;

/** Report-only church archetype derived from interpreted/size fields + growth
 *  signals. Growth orientation now beats the old attendance-only fallback (a
 *  growing 250-person church is a Growth Church, not Legacy), and a 30-year-old
 *  church can never be a "Church Plant". */
export function deriveArchetype(fields: FieldMap, accessLevel: string, signals: ArchetypeSignals = {}): Derived {
  const att = num(fields.avg_weekly_attendance);
  const online = num(fields.online_attendance_estimate);
  const campuses = num(fields.campus_count);
  const digital = num(fields.digital_maturity_score) ?? 0;
  const growth = num(fields.growth_orientation_score) ?? 0;
  const stage = String(fields.lifecycle_stage?.value ?? '');
  const cap = capForAccess(accessLevel as EvidenceAccessLevel);

  // Growth orientation: explicit multiplication signals (residency/hiring/
  // microchurch ≈ multisite) OR a strong growth score. Independent of size.
  const growthOriented = !!signals.residency || !!signals.hiring || growth >= 65;
  const multisite = (campuses != null && campuses >= 2) || !!signals.multisite;
  const declining = stage === 'declining';
  const plateaued = stage === 'plateaued';

  const ev: string[] = [];
  if (att != null) ev.push(`attendance≈${att}`);
  if (campuses != null) ev.push(`campuses=${campuses}`);
  if (stage) ev.push(`lifecycle=${stage}`);
  ev.push(`digital=${digital}`, `growth=${growth}`);
  const flags = Object.entries(signals).filter(([, v]) => v).map(([k]) => k);
  if (flags.length) ev.push(`signals=${flags.join('+')}`);

  let value = 'Unclassified';
  // Celebrity pastor → distinct category, independent of (and above) raw size.
  if (signals.celebrity) value = 'Celebrity Church';
  else if (stage === 'relaunch_revitalization') value = 'Revitalization Church';
  else if (att != null && att >= 10000) value = 'Giga Church';
  // Mega and multi-campus usually coincide.
  else if (multisite && att != null && att >= 2000) value = 'Mega / Multi-Campus Church';
  else if (att != null && att >= 2000) value = (plateaued || declining) ? 'Plateaued Mega Church' : 'Mega Church';
  else if (multisite && (att == null || att >= 500)) value = 'Multi-Campus Church';
  else if (att != null && att >= 500) value = growthOriented ? 'Growth Church' : (plateaued || declining ? 'Institutional Church' : 'Healthy Regional Church');
  else if (stage === 'plant') value = 'Church Plant';                       // ONLY when explicitly a plant
  else if (declining) value = 'Declining Church';                           // a legacy church in decline
  else if (growthOriented && !plateaued) value = 'Growth Church';           // growth beats the size-only Legacy fallback
  else if (plateaued) value = 'Institutional Church';
  else if (stage === 'established' || (att != null && att < 500)) value = 'Legacy Church';

  if (value === 'Unclassified') {
    if (stage === 'growing') value = 'Growth Church';
    else if (stage === 'established') value = 'Legacy Church';
    else value = 'Legacy Church';
  }

  let conf = 30;
  if (att != null) conf += 20;
  if (campuses != null) conf += 10;
  if (stage) conf += 10;
  return { value, confidence: Math.min(conf, cap), evidence: ev.join(', ') };
}

/** Report-only contactability score: weighted completeness of relationship data. */
export function deriveContactability(scoreConf: ScoreConfidence | undefined, fields: FieldMap, accessLevel: string): Derived {
  const has = (k: string) => fields[k]?.value != null && fields[k]?.value !== '';
  const cap = capForAccess(accessLevel as EvidenceAccessLevel);
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
  const confidence = Math.min(scoreConf?.confidence ?? 60, cap);
  return { value: String(score), confidence, evidence: scoreConf?.reason ? `${evidence} · ${scoreConf.reason}` : evidence };
}

// ── interpretation ───────────────────────────────────────────────────────────
export interface InterpretInput {
  normalized: NormalizedEvidence;
  synthesis: DossierSynthesis;
  facts: Facts;
  accessLevel: EvidenceAccessLevel;
  scoreConfidence: Record<string, ScoreConfidence>;
  identity: { inputMode?: string; websiteVerificationStatus?: string; identityVerdict?: string };
}

const DIMENSION_FOR_SCORE: Record<string, string> = {
  digital_maturity_score: 'digital_maturity',
  growth_orientation_score: 'growth_orientation',
  change_readiness_score: 'change_readiness',
  staff_depth_score: 'organizational_capacity',
};

export function interpretDossier(input: InterpretInput): Interpretation {
  const { normalized, synthesis, facts, accessLevel, scoreConfidence, identity } = input;
  const cap = (n: number) => Math.min(Math.max(0, Math.round(n)), capForAccess(accessLevel));

  const mk = <T,>(value: T, confidence: number, ids: string[], reason: string, lvl: EvidenceAccessLevel = accessLevel): Conclusion<T> =>
    ({ value, confidence: cap(confidence), evidence_ids: ids, reason, access_level: lvl });

  const bestAccessOf = (rows: NormalizedRow[]): EvidenceAccessLevel => rows[0]?.access_level ?? accessLevel;

  // ── leadership (from normalized leaders, NOT first-match facts) ────────────
  const leadRows = normalized.leaders.filter((l) => l.category === 'lead_pastor');
  const lead_pastors: Conclusion<string[]> = leadRows.length
    ? mk(dedupe(leadRows.map((l) => l.value)), Math.max(...leadRows.map((l) => l.confidence)),
        leadRows.map((l) => l.id),
        `Named (co-)lead pastor(s) in normalized evidence: ${leadRows.map((l) => `${l.value} (${l.detail})`).join('; ')}.`,
        bestAccessOf(leadRows))
    // compat fallback: synthesis opinion only when NO normalized leader exists.
    : mk(synthesis.lead_pastor ? [synthesis.lead_pastor] : [], synthesis.lead_pastor ? 45 : 0, [],
        synthesis.lead_pastor ? 'From synthesis opinion (no normalized leader rows).' : 'No leader evidence.');

  const roleConclusion = (role: string): Conclusion<string | null> => {
    const row = normalized.leaders.find((l) => l.category === role);
    return row
      ? mk<string | null>(row.value, row.confidence, [row.id], `${role} in normalized evidence: ${row.value} (${row.detail}).`, row.access_level)
      : mk<string | null>(null, 0, [], `No ${role} found in normalized evidence.`);
  };

  // ── contacts (from normalized contacts) ───────────────────────────────────
  const contactConclusion = (category: string): Conclusion<string | null> => {
    const row = normalized.contacts.find((c) => c.category === category);
    return row
      ? mk<string | null>(row.value, row.confidence, [row.id], `Public office ${category} from normalized evidence.`, row.access_level)
      : mk<string | null>(null, 0, [], `No office ${category} in normalized evidence.`);
  };
  const office_email = contactConclusion('email');
  const office_phone = contactConclusion('phone');

  // staff_count — single conclusion: deterministic extractor first, synthesis
  // estimate only as a labelled fallback (no longer mutated into facts upstream).
  const staffFact = facts.staff_count;
  const staff_count: Conclusion<number | null> = staffFact?.value != null
    ? mk<number | null>(Number(staffFact.value), staffFact.confidence, [], 'Extracted staff_count from evidence.', staffFact.access_level)
    : (synthesis.staff_count != null
        ? mk<number | null>(synthesis.staff_count, synthesis.staff_count_confidence || 40, [], 'Estimated from indirect signals (synthesis).')
        : mk<number | null>(null, 0, [], 'No staff-count evidence.'));

  // ── Average Weekend Attendance — reported > staff-ratio > synthesis ─────────
  // Staff is one of the best size indicators: ~1 FTE per 75 AWA (smaller
  // churches) rising to ~100–125 for larger ones. 2+ service times implies ~300+.
  // Computed BEFORE the archetype so size tiers use the improved estimate.
  const reportedFact = facts.reported_attendance;
  const staffN = staff_count.value;
  const services = normalized.services.length;
  let attValue: number | null;
  let attendance_source: AttendanceSource;
  let attConfidence: number;
  let attMethod: string;
  let attendance_range: { min: number | null; max: number | null };
  if (reportedFact?.value != null) {
    attValue = Number(reportedFact.value);
    attendance_source = 'reported'; attConfidence = reportedFact.confidence; attMethod = 'publicly stated';
    attendance_range = { min: round25(attValue * 0.9), max: round25(attValue * 1.1) };
  } else if (staffN != null && staffN > 0) {
    const factor = staffN >= 25 ? 110 : staffN >= 10 ? 90 : 75;   // larger churches carry more AWA per FTE
    let est = staffN * factor;
    if (services >= 2) est = Math.max(est, 300);                  // 2 services ⇒ rarely under ~300
    attValue = round25(est);
    attendance_source = 'inferred'; attConfidence = 58;
    attMethod = `staff ratio (~${factor} AWA/FTE × ${staffN} staff${services >= 2 ? ` · ${services} service times` : ''})`;
    attendance_range = { min: round25(Math.max(services >= 2 ? 300 : 0, staffN * 55)), max: round25(staffN * 125) };
  } else if (synthesis.attendance_estimate != null) {
    attValue = synthesis.attendance_estimate;
    attendance_source = 'inferred'; attConfidence = synthesis.attendance_confidence; attMethod = 'synthesis estimate';
    attendance_range = { min: synthesis.attendance_min ?? null, max: synthesis.attendance_max ?? null };
  } else if (services >= 2) {
    attValue = 300; attendance_source = 'inferred'; attConfidence = 40; attMethod = `${services} service times`;
    attendance_range = { min: 300, max: 600 };
  } else {
    attValue = null; attendance_source = 'unknown'; attConfidence = 0; attMethod = '';
    attendance_range = { min: synthesis.attendance_min ?? null, max: synthesis.attendance_max ?? null };
  }

  // ── scores (kept from synthesis for now; referenced to external signals) ──
  const scoreConclusion = (key: keyof DossierSynthesis): Conclusion<number | null> => {
    const value = (synthesis[key] as number | null) ?? null;
    const dim = DIMENSION_FOR_SCORE[key as string];
    const ids = dim ? normalized.external_signals.filter((s) => (s.detail ?? '').includes(dim)).map((s) => s.id) : [];
    const sc = scoreConfidence[key as string];
    const reason = value == null
      ? 'Insufficient evidence — no synthesized score.'
      : `${sc?.tier ?? 'synthesized'} (${sc?.reason ?? 'from synthesis'})${ids.length ? ` · ${ids.length} supporting external signal(s)` : ''}`;
    return mk<number | null>(value, sc?.confidence ?? (value == null ? 0 : 50), ids, reason);
  };

  // ── archetype + contactability (report-only derivations, now interpreted) ──
  const archFields: FieldMap = {
    avg_weekly_attendance: { value: attValue, confidence: null },
    online_attendance_estimate: { value: synthesis.online_attendance_estimate, confidence: null },
    campus_count: { value: facts.campus_count?.value ?? null, confidence: null },
    digital_maturity_score: { value: synthesis.digital_maturity_score, confidence: null },
    growth_orientation_score: { value: synthesis.growth_orientation_score, confidence: null },
    lifecycle_stage: { value: synthesis.lifecycle_stage, confidence: null },
  };
  const arch = deriveArchetype(archFields, accessLevel, {
    residency: normalized.external_signals.some((s) => s.category === 'internship_residency'),
    hiring: normalized.external_signals.some((s) => s.category === 'jobs_hiring'),
    multisite: facts.campus_count?.value != null && Number(facts.campus_count.value) >= 2,
    network: normalized.external_signals.some((s) => s.category === 'network_affiliation'),
    school: normalized.external_signals.some((s) => s.category === 'school_academy'),
    celebrity: isCelebrityPastor(lead_pastors.value),
  });

  const contactFields: FieldMap = {
    lead_pastor: { value: lead_pastors.value[0] ?? null, confidence: null },
    executive_pastor: { value: roleConclusion('executive_pastor').value, confidence: null },
    operations_leader: { value: roleConclusion('operations_leader').value, confidence: null },
    communications_leader: { value: roleConclusion('communications_leader').value, confidence: null },
    office_email: { value: office_email.value, confidence: null },
    office_phone: { value: office_phone.value, confidence: null },
  };
  const contact = deriveContactability(scoreConfidence.contactability, contactFields, accessLevel);

  const known_church_verified = identity.inputMode === 'known_church' &&
    (identity.websiteVerificationStatus === 'verified' || identity.identityVerdict === 'true_match');

  const attendance_evidence: AttendanceFactor[] = [];
  const addAtt = (factor: string, detail: string, ids: string[]) => attendance_evidence.push({ factor, detail, evidence_ids: ids });
  if (staff_count.value != null) addAtt('staff_count', `${staff_count.value} staff`, staff_count.evidence_ids);
  const chms = normalized.technology_stack.filter((t) => t.category === 'ChMS');
  if (chms.length) addAtt('church_center_usage', `active ${chms.map((t) => t.value).join(', ')}`, chms.map((t) => t.id));
  if (normalized.services.length) addAtt('service_times', `${normalized.services.length} service time(s): ${normalized.services.map((s) => s.value).join(', ')}`, normalized.services.map((s) => s.id));
  const grp = normalized.external_signals.filter((s) => s.category === 'groups');
  if (grp.length) addAtt('volunteer_infrastructure', 'groups/volunteer systems present', grp.map((s) => s.id));
  if (normalized.ministries.length) addAtt('ministry_breadth', `${normalized.ministries.length} ministry pathway(s)`, normalized.ministries.map((m) => m.id));
  if (facts.campus_count?.value != null) addAtt('campus_count', `${facts.campus_count.value} campus(es)`, []);
  if (reportedFact) addAtt('reported_statement', reportedFact.evidence, []);
  const attIds = [...new Set(attendance_evidence.flatMap((a) => a.evidence_ids))];
  const rangeStr = attendance_range.min != null && attendance_range.max != null ? ` Range ${attendance_range.min}–${attendance_range.max}.` : '';
  const attendance_reasoning = attValue == null
    ? 'No attendance estimate — insufficient size evidence.'
    : `${attendance_source === 'reported' ? `Reported ${attValue} (publicly stated).` : `Inferred ~${attValue} via ${attMethod}.`}${attendance_evidence.length ? ` Supporting evidence: ${attendance_evidence.map((a) => a.detail).join('; ')}.` : ''}${rangeStr} Source: ${attendance_source}.`;

  return {
    lead_pastors,
    executive_pastor: roleConclusion('executive_pastor'),
    operations_leader: roleConclusion('operations_leader'),
    communications_leader: roleConclusion('communications_leader'),
    office_email,
    office_phone,
    staff_count,
    address: (() => {
      const a = normalized.locations[0];
      return a
        ? mk<string | null>(a.value, a.confidence, [a.id], 'Address from normalized location evidence.', a.access_level)
        : mk<string | null>(null, 0, [], 'No address in normalized evidence.');
    })(),
    denomination: mk<string | null>(synthesis.denomination, synthesis.denomination ? 60 : 0, [], 'From synthesis (denomination).'),
    attendance_estimate: mk<number | null>(attValue, attConfidence, attIds, attendance_reasoning, reportedFact?.access_level ?? accessLevel),
    attendance_source,
    attendance_range,
    attendance_evidence,
    attendance_reasoning,
    lifecycle_stage: mk<string>(synthesis.lifecycle_stage, 60, [], synthesis.lifecycle_summary || 'From synthesis (lifecycle).'),
    archetype: mk<string>(arch.value, arch.confidence, [], arch.evidence),
    digital_maturity_score: scoreConclusion('digital_maturity_score'),
    growth_orientation_score: scoreConclusion('growth_orientation_score'),
    change_readiness_score: scoreConclusion('change_readiness_score'),
    staff_depth_score: scoreConclusion('staff_depth_score'),
    contactability_score: mk<number>(Number(contact.value), contact.confidence, [], contact.evidence),
    known_church_verified,
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
