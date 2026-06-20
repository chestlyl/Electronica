import { z } from 'zod';
import type { SourceFinding } from '../research/dossier.js';
import type { ResearchConflict } from '../types.js';

export const LIFECYCLE_VALUES = [
  'plant', 'growing', 'established', 'relaunch_revitalization', 'plateaued',
  'declining', 'merged', 'closed', 'unknown',
] as const;

const synthField = z.object({
  field_name: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(100),
  evidence: z.string(),
  access_level: z.string().optional(),
});

export const dossierSynthesisSchema = z.object({
  identity_summary: z.string(),
  digital_summary: z.string(),
  staff_summary: z.string(),
  growth_summary: z.string(),
  lifecycle_summary: z.string(),
  research_summary: z.string(),
  lifecycle_stage: z.enum(LIFECYCLE_VALUES),
  growth_orientation_score: z.number().min(0).max(100),
  digital_maturity_score: z.number().min(0).max(100),
  change_readiness_score: z.number().min(0).max(100),
  staff_depth_score: z.number().min(0).max(100),
  church_app_status: z.enum(['active', 'planned', 'none_found', 'unknown']),
  app_provider: z.string().nullable(),
  lead_pastor: z.string().nullable(),
  denomination: z.string().nullable(),
  online_attendance_estimate: z.number().nullable(),
  online_attendance_confidence: z.number().min(0).max(100),
  attendance_estimate: z.number().nullable(),
  attendance_min: z.number().nullable(),
  attendance_max: z.number().nullable(),
  attendance_confidence: z.number().min(0).max(100),
  fields: z.array(synthField),
  known: z.array(z.string()),
  uncertain: z.array(z.string()),
});
export type DossierSynthesis = z.infer<typeof dossierSynthesisSchema>;

export function renderFindings(findings: SourceFinding[], maxChars = 6000): string {
  const lines: string[] = [];
  for (const f of findings) {
    const body = (f.fetched ? f.text : f.snippet) ?? '';
    lines.push(
      `- [${f.sourceType} | access=${f.accessLevel} | fetched=${f.fetched} | rel=${f.reliability}] ${f.url}` +
        (f.title ? `\n   title: ${f.title}` : '') +
        (body ? `\n   text: ${body.slice(0, 400)}` : '') +
        (f.fields.length ? `\n   extracted: ${f.fields.map((x) => `${x.field_name}=${x.value}`).join('; ')}` : ''),
    );
  }
  return lines.join('\n').slice(0, maxChars);
}

export const dossierSynthesisPrompt = {
  system: `You are a church research analyst building a DOSSIER from MULTIPLE public
source types (official site, search snippets, social, staff pages, job postings,
directories, news, vendor references). Triangulate evidence the way a careful
human analyst would.

RULES:
- Establish "this is THE site for THIS church" — never confuse a same-named church
  in another city, and never treat a vendor/contractor or news page as the church.
- Do NOT optimize for confidence. Prefer "Unknown"/null and LOW confidence over
  false precision. Optimize for honestly marking what is uncertain.
- If the official website was NOT fetched (no access_level=live_official_site
  finding), say so and keep confidence modest — the platform will additionally CAP
  it. Vendor/news evidence is supporting only.
- Score lifecycle_stage and the strategic scores from real signals (relaunch/
  rebrand language → change_readiness & relaunch_revitalization; hiring/new
  ministries → growth & staff_depth; app/livestream/giving/social stack → digital
  maturity).
- For every field in "fields", attach the evidence and the source access_level.`,
  user(opts: {
    name: string; city: string | null; state: string | null;
    officialSite: string | null; officialCrawled: boolean;
    findings: SourceFinding[]; conflicts: ResearchConflict[]; contamination: string[];
    facts?: Record<string, { value: string | number | boolean; confidence: number; source_url: string }>;
  }): string {
    const factLines = opts.facts && Object.keys(opts.facts).length
      ? Object.entries(opts.facts).map(([k, v]) => `- ${k} = ${v.value} (conf ${v.confidence}, ${v.source_url})`).join('\n')
      : '- none';
    return `CHURCH: ${opts.name}
LOCATION: ${[opts.city, opts.state].filter(Boolean).join(', ') || 'unknown'}
OFFICIAL SITE (identity): ${opts.officialSite ?? 'NOT CONFIDENTLY IDENTIFIED'}
OFFICIAL SITE DOM FETCHED: ${opts.officialCrawled ? 'yes' : 'NO — only indexed snippets/third-party sources available; cap confidence'}

CONFLICTS DETECTED (preserve, do not resolve silently):
${opts.conflicts.length ? opts.conflicts.map((c) => `- ${c.field_name}: "${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b})`).join('\n') : '- none'}

CONTAMINATION FLAGS:
${opts.contamination.length ? opts.contamination.map((c) => `- ${c}`).join('\n') : '- none'}

DETERMINISTIC EXTRACTIONS (regex over the evidence — confirm or override these):
${factLines}

EVIDENCE (${opts.findings.length} findings):
${renderFindings(opts.findings)}

Return a JSON dossier with the schema fields: identity_summary, digital_summary,
staff_summary, growth_summary, lifecycle_summary, research_summary, lifecycle_stage,
growth_orientation_score, digital_maturity_score, change_readiness_score,
staff_depth_score, church_app_status, app_provider, lead_pastor, denomination,
online_attendance_estimate, online_attendance_confidence, attendance_estimate,
attendance_min, attendance_max, attendance_confidence, fields[], known[], uncertain[].`;
  },
  schema: dossierSynthesisSchema,
};
