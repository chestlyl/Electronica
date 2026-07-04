import type { DossierSynthesis } from "../claude/dossierPrompt.js";

/**
 * Lite (contact-focus) enrichment support.
 *
 * The research pipeline's ONLY Claude call is the dossier "synthesis" (the
 * on-the-ground narrative + estimates). Lite mode SKIPS it — so a lite run costs
 * ZERO Claude tokens and still gathers everything from the deterministic
 * extractors: tech stack, attendance (reported-attendance lookup + inference),
 * staff/leadership, and contacts. Breadth over depth: cover many churches
 * cheaply, reserve the full narrative for the few you deep-research.
 *
 * Because lite mode has no LLM-scored inputs, outreach fit is a DETERMINISTIC
 * proxy (computeLiteFit) built from the things we actually gathered.
 */

export interface LiteFitInput {
  attendance: number | null; // estimated average weekend attendance
  hasEmail: boolean; // a usable contact email exists (outreach gate)
  staffCount: number | null; // known staff/leaders
  techCount: number; // detected platforms (digital maturity proxy)
  active: boolean; // not closed/merged
}

/**
 * Deterministic outreach-fit proxy in 0..100 (no Claude). Weighting:
 *   attendance band 45 · contactable (has email) 30 · tech/digital 15 · staff 10.
 * A closed/merged church scores 0.
 */
export function computeLiteFit(i: LiteFitInput): number {
  if (!i.active) return 0;
  const a = i.attendance ?? 0;
  const attendancePts = a >= 2000 ? 45 : a >= 1000 ? 38 : a >= 500 ? 30 : a >= 250 ? 22 : a >= 100 ? 14 : a > 0 ? 8 : 0;
  const contactPts = i.hasEmail ? 30 : 0;
  const techPts = Math.min(Math.max(i.techCount, 0), 5) * 3; // up to 15
  const s = i.staffCount ?? 0;
  const staffPts = s >= 10 ? 10 : s >= 5 ? 7 : s >= 2 ? 4 : s >= 1 ? 2 : 0;
  return Math.max(0, Math.min(100, Math.round(attendancePts + contactPts + techPts + staffPts)));
}

/**
 * Deterministic stand-in for the Claude synthesis used in lite mode. Everything
 * is null/empty so the interpretation layer falls back to deterministic facts
 * (reported attendance, extracted staff/contacts) rather than an LLM estimate.
 */
export function liteSynthesis(): DossierSynthesis {
  return {
    identity_summary: "",
    digital_summary: "",
    staff_summary: "",
    growth_summary: "",
    lifecycle_summary: "",
    research_summary: "Lite enrichment — deterministic tech / attendance / staff / contacts only (no LLM synthesis).",
    lifecycle_stage: "unknown",
    growth_orientation_score: null,
    digital_maturity_score: null,
    change_readiness_score: null,
    staff_depth_score: null,
    church_app_status: "unknown",
    app_provider: null,
    lead_pastor: null,
    denomination: null,
    online_attendance_estimate: null,
    online_attendance_confidence: 0,
    attendance_estimate: null,
    attendance_min: null,
    attendance_max: null,
    attendance_confidence: 0,
    staff_count: null,
    staff_count_confidence: 0,
    campus_count: null,
    campus_count_confidence: 0,
    fields: [],
    known: [],
    uncertain: [],
  };
}
