import { z } from 'zod';
import type { ResearchBundle } from '../research/types.js';
import type { Church } from '../types.js';

/**
 * Shared confidence rubric injected into every agent system prompt so the
 * model scores consistently with the platform's auto-update rules.
 */
export const CONFIDENCE_RUBRIC = `
CONFIDENCE SCALE (0-100) — score every claim:
  90-100 : direct evidence from the church's OWN official site or an official report
  75-89  : strong evidence corroborated by multiple independent sources
  60-74  : plausible but incomplete evidence
  40-59  : weak or indirect evidence
  0-39   : insufficient / speculative
Rules:
- Never overstate confidence. If you are guessing, score it low.
- Prefer "Unknown"/null over false precision.
- Only use information visible in the provided public page text and search snippets.
- Always ground a claim in evidence_text quoted or paraphrased from the sources,
  and cite the source_url it came from.
`.trim();

export const ETHICS_RUBRIC = `
SOURCING CONSTRAINTS:
- Use only public web content provided to you.
- Do not infer private/personal data (home addresses, personal cell numbers, etc.).
- Public-facing org contact info (church office phone/email, staff page) is fine.
`.trim();

/** Compact the research bundle into a token-efficient context block. */
export function renderResearchContext(bundle: ResearchBundle, maxPageChars = 3500): string {
  const lines: string[] = [];
  lines.push(`SEARCH QUERY: ${bundle.query}`);
  lines.push(`OFFICIAL SITE (best guess): ${bundle.officialSite ?? 'unknown'}`);
  lines.push(`ORIGINAL SITE REACHABLE: ${bundle.originalSiteWorks ?? 'unknown'}`);
  if (bundle.discoveryNote) lines.push(`DISCOVERY: ${bundle.discoveryNote}`);
  lines.push(`CRAWL METHOD: ${bundle.crawlMethod} (JS rendered: ${bundle.jsRendered})`);
  if (!bundle.jsRendered) {
    lines.push(
      'NOTE: pages were fetched WITHOUT JavaScript rendering; some dynamic ' +
        'content may be missing. Do not lower confidence for content that is ' +
        'present, but avoid asserting the ABSENCE of something as strong evidence.',
    );
  }
  if (bundle.note) lines.push(`NOTE: ${bundle.note}`);
  lines.push('');
  lines.push('TOP SEARCH RESULTS:');
  bundle.searchResults.slice(0, 6).forEach((r, i) => {
    lines.push(`  [${i + 1}] ${r.title}\n      ${r.url}\n      ${r.snippet}`);
  });
  lines.push('');
  lines.push('FETCHED PAGES:');
  for (const p of bundle.pages) {
    if (!p.ok) {
      lines.push(`--- (${p.category}) ${p.url} -> ERROR ${p.status} ${p.error ?? ''}`);
      continue;
    }
    lines.push(`--- (${p.category}) ${p.finalUrl} | title: ${p.title}`);
    lines.push(p.text.slice(0, maxPageChars));
  }
  return lines.join('\n');
}

function churchHeader(c: Pick<Church, 'name' | 'city' | 'state' | 'website_original' | 'phone_original' | 'email_original'>): string {
  return [
    `CHURCH: ${c.name ?? ''}`,
    `LOCATION: ${[c.city, c.state].filter(Boolean).join(', ')}`,
    `ORIGINAL WEBSITE: ${c.website_original ?? 'none'}`,
    `ORIGINAL PHONE: ${c.phone_original ?? 'none'}`,
    `ORIGINAL EMAIL: ${c.email_original ?? 'none'}`,
  ].join('\n');
}

const evidenceItem = z.object({
  field_name: z.string(),
  proposed_value: z.string().nullable(),
  evidence_text: z.string(),
  source_url: z.string().nullable(),
  confidence_score: z.number().min(0).max(100),
});
export type LlmEvidenceItem = z.infer<typeof evidenceItem>;

// ── 1. Verification ────────────────────────────────────────────────────────
export const verificationSchema = z.object({
  active_status: z.enum(['Verified Active', 'Likely Active', 'Uncertain', 'Closed', 'Merged']),
  website_verified: z.string().nullable(),
  website_verified_confidence: z.number().min(0).max(100),
  active_status_confidence: z.number().min(0).max(100),
  closure_merger_signals: z.array(z.string()),
  reasoning: z.string(),
  evidence: z.array(evidenceItem),
});
export type VerificationResult = z.infer<typeof verificationSchema>;

export const verificationPrompt = {
  system: `You are a church verification analyst. Decide whether a church still
operates, and identify its official website. Look for signs of closure, merger,
rename, or relocation (e.g. "permanently closed", "now meeting at", "merged with",
"this domain is for sale", real estate listings, no service times, dead site).
${CONFIDENCE_RUBRIC}
${ETHICS_RUBRIC}`,
  user(c: Church, bundle: ResearchBundle): string {
    return `${churchHeader(c)}

${renderResearchContext(bundle)}

Return JSON:
{
  "active_status": "Verified Active|Likely Active|Uncertain|Closed|Merged",
  "active_status_confidence": 0-100,
  "website_verified": "official url or null",
  "website_verified_confidence": 0-100,
  "closure_merger_signals": ["..."],
  "reasoning": "2-3 sentences",
  "evidence": [{"field_name":"active_status|website_verified","proposed_value":"...","evidence_text":"...","source_url":"...","confidence_score":0-100}]
}`;
  },
  schema: verificationSchema,
};

// ── 2. Contact enrichment ──────────────────────────────────────────────────
export const contactSchema = z.object({
  email_verified: z.string().nullable(),
  email_confidence: z.number().min(0).max(100),
  phone_verified: z.string().nullable(),
  phone_confidence: z.number().min(0).max(100),
  lead_pastor: z.string().nullable(),
  lead_pastor_confidence: z.number().min(0).max(100),
  evidence: z.array(evidenceItem),
});
export type ContactResult = z.infer<typeof contactSchema>;

export const contactPrompt = {
  system: `You extract PUBLIC-FACING church contact information: office email,
office phone, and the lead/senior pastor's name. Use only public contact and
staff pages. Do NOT extract private, hidden, or gated data, and do not guess an
email pattern that isn't actually published.
${CONFIDENCE_RUBRIC}
${ETHICS_RUBRIC}`,
  user(c: Church, bundle: ResearchBundle): string {
    return `${churchHeader(c)}

${renderResearchContext(bundle)}

Identify the lead/senior pastor (the top leader; ignore worship/kids/exec pastors
unless they are clearly the senior leader). Return JSON:
{
  "email_verified": "office email or null",
  "email_confidence": 0-100,
  "phone_verified": "office phone or null",
  "phone_confidence": 0-100,
  "lead_pastor": "full name or null",
  "lead_pastor_confidence": 0-100,
  "evidence": [{"field_name":"email_verified|phone_verified|lead_pastor","proposed_value":"...","evidence_text":"...","source_url":"...","confidence_score":0-100}]
}`;
  },
  schema: contactSchema,
};

// ── 3. Denomination & network ──────────────────────────────────────────────
export const denominationSchema = z.object({
  denomination: z.string(),
  denomination_confidence: z.number().min(0).max(100),
  network_affiliation: z.string(),
  network_confidence: z.number().min(0).max(100),
  evidence: z.array(evidenceItem),
});
export type DenominationResult = z.infer<typeof denominationSchema>;

export const denominationPrompt = {
  system: `You classify a church's denomination and church-planting network from
public clues on About, Beliefs, Partners, Footer, Staff, and Church Planting pages.
Known denominations/networks include: SBC, Assemblies of God, Nazarene, Methodist,
Presbyterian, Lutheran, Vineyard, Foursquare, ARC, Acts 29, Exponential, CMN,
Send Network, NewThing, Converge, EFCA, or "Independent / Non-Denominational".
A church can have BOTH a denomination and a separate planting-network affiliation.
If unclear, return "Unknown" — do NOT guess.
${CONFIDENCE_RUBRIC}
${ETHICS_RUBRIC}`,
  user(c: Church, bundle: ResearchBundle): string {
    return `${churchHeader(c)}
SEED PARENT ORG (from legacy data, may hint at district/denomination): ${c.network_affiliation ?? 'none'}

${renderResearchContext(bundle)}

Return JSON:
{
  "denomination": "name or Unknown",
  "denomination_confidence": 0-100,
  "network_affiliation": "name or Unknown",
  "network_confidence": 0-100,
  "evidence": [{"field_name":"denomination|network_affiliation","proposed_value":"...","evidence_text":"...","source_url":"...","confidence_score":0-100}]
}`;
  },
  schema: denominationSchema,
};

// ── 4. Size estimation ─────────────────────────────────────────────────────
export const sizeSchema = z.object({
  attendance_estimate: z.number().nullable(),
  attendance_min: z.number().nullable(),
  attendance_max: z.number().nullable(),
  attendance_confidence: z.number().min(0).max(100),
  attendance_confidence_tier: z.enum(['High', 'Medium', 'Low', 'Very Low']),
  staff_count: z.number().nullable(),
  campus_count: z.number().nullable(),
  weekend_services_count: z.number().nullable(),
  reasoning: z.string(),
  evidence: z.array(evidenceItem),
});
export type SizeResult = z.infer<typeof sizeSchema>;

export const sizePrompt = {
  system: `You estimate weekly worship attendance from EVIDENCE, never a blind guess.
Evidence hierarchy (most -> least reliable):
  1. Published attendance / annual report numbers        -> Very High confidence
  2. # of weekend services, # of campuses, staff count   -> High confidence
  3. Google reviews count, social/YouTube followers      -> Medium confidence
  4. Building/parking-lot photos, indirect indicators     -> Low confidence
ALWAYS return a min/max range and a confidence score. If evidence is weak, use a
BROAD range and Low/Very Low confidence. Prefer null estimate over false precision.
Rough conversions if needed: a typical service fills 60-80% of seating; multiply
attendance by ~1.5 for "people reached". Count distinct weekend services/campuses.
${CONFIDENCE_RUBRIC}
${ETHICS_RUBRIC}`,
  user(c: Church, bundle: ResearchBundle): string {
    return `${churchHeader(c)}

${renderResearchContext(bundle)}

Return JSON:
{
  "attendance_estimate": number or null,
  "attendance_min": number or null,
  "attendance_max": number or null,
  "attendance_confidence": 0-100,
  "attendance_confidence_tier": "High|Medium|Low|Very Low",
  "staff_count": number or null,
  "campus_count": number or null,
  "weekend_services_count": number or null,
  "reasoning": "explain which evidence drove the estimate and the range width",
  "evidence": [{"field_name":"attendance_estimate|staff_count|campus_count|weekend_services_count","proposed_value":"...","evidence_text":"...","source_url":"...","confidence_score":0-100}]
}`;
  },
  schema: sizeSchema,
};

// ── 5. Multiplication & MMC fit ────────────────────────────────────────────
export const multiplicationSchema = z.object({
  church_planting_activity: z.number().min(0).max(100),
  disciple_making: z.number().min(0).max(100),
  leadership_development: z.number().min(0).max(100),
  residency_internship: z.number().min(0).max(100),
  mission_sending: z.number().min(0).max(100),
  kingdom_collaboration: z.number().min(0).max(100),
  innovation: z.number().min(0).max(100),
  multiplication_orientation: z.number().min(0).max(100),
  digital_reach: z.number().min(0).max(100),
  explanation: z.string(),
  evidence: z.array(evidenceItem),
});
export type MultiplicationResult = z.infer<typeof multiplicationSchema>;

export const multiplicationPrompt = {
  system: `You read public church website content and rate multiplication & Kingdom
signals 0-100 each, grounded in quotes from the pages. Rate:
- church_planting_activity: plants churches, "we've planted N", planting residency
- disciple_making: explicit disciple-making pathways/language
- leadership_development: leadership pipeline, cohorts, training
- residency_internship: named residency/internship programs
- mission_sending: sends missionaries/teams, global & local mission
- kingdom_collaboration: partners across networks/denominations for the Kingdom
- innovation: new models, multisite, online campus, creative outreach
- multiplication_orientation: overall DNA of reproducing disciples/leaders/churches
- digital_reach: website quality + online services/app/podcast + social presence
Score 0 only when there is genuinely no signal. Quote evidence.
${CONFIDENCE_RUBRIC}
${ETHICS_RUBRIC}`,
  user(c: Church, bundle: ResearchBundle): string {
    return `${churchHeader(c)}

${renderResearchContext(bundle)}

Return JSON with each sub-score 0-100:
{
  "church_planting_activity": 0-100,
  "disciple_making": 0-100,
  "leadership_development": 0-100,
  "residency_internship": 0-100,
  "mission_sending": 0-100,
  "kingdom_collaboration": 0-100,
  "innovation": 0-100,
  "multiplication_orientation": 0-100,
  "digital_reach": 0-100,
  "explanation": "2-4 sentences citing the strongest signals",
  "evidence": [{"field_name":"multiplication","proposed_value":"...","evidence_text":"...","source_url":"...","confidence_score":0-100}]
}`;
  },
  schema: multiplicationSchema,
};
