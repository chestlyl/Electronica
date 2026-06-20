import { discoverWebsite, type DiscoveryResult } from './discovery.js';
import {
  capConfidence,
  dossierAccessLevel,
  officialSiteWasCrawled,
  type SourceFinding,
} from './dossier.js';
import { collectWebsite } from './sources/website.js';
import { collectSnippets } from './sources/snippets.js';
import { extractFacts, type Facts } from './extractors.js';
import { dossierSynthesisPrompt, type DossierSynthesis } from '../claude/dossierPrompt.js';
import type { LlmProvider } from '../claude/client.js';
import type { ResearchProvider } from './types.js';
import type {
  Church,
  EvidenceAccessLevel,
  ResearchConflict,
  ResearchDossier,
} from '../types.js';

export interface ResearchTarget {
  name: string;
  city: string | null;
  state: string | null;
  originalWebsite: string | null;
  alternateName: string | null;
}

export interface ResearchDeps {
  llm: LlmProvider;
  research: ResearchProvider;
}

export interface DossierBuild {
  identity: DiscoveryResult;
  findings: SourceFinding[];
  conflicts: ResearchConflict[];
  contamination: string[];
  synthesis: DossierSynthesis;
  facts: Facts;
  dossier: ResearchDossier;
  strategic: Partial<Church>;
  fieldEstimates: { field_name: string; value: string | number | null; confidence: number; evidence: string; access_level: EvidenceAccessLevel }[];
  officialSite: string | null;
  accessLevel: EvidenceAccessLevel;
  officialCrawled: boolean;
  tokens: number;
  cost: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).toString(); } catch { return null; }
}

// ── conflict detection (never resolve silently) ─────────────────────────────
const CONFLICT_KEYS: Record<string, { key: string; norm: (v: string) => string }> = {
  lead_pastor_title_mention: { key: 'lead_pastor_role', norm: (v) => (v.match(/lead|senior|associate|executive|founding/i)?.[0] ?? v).toLowerCase() },
  phone: { key: 'phone', norm: (v) => v.replace(/\D/g, '') },
  address: { key: 'address', norm: (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '') },
};

function detectConflicts(findings: SourceFinding[]): ResearchConflict[] {
  const groups = new Map<string, { value: string; norm: string; finding: SourceFinding }[]>();
  for (const f of findings) {
    for (const field of f.fields) {
      const mapping = CONFLICT_KEYS[field.field_name];
      if (!mapping || field.value == null) continue;
      const value = String(field.value);
      const arr = groups.get(mapping.key) ?? [];
      arr.push({ value, norm: mapping.norm(value), finding: f });
      groups.set(mapping.key, arr);
    }
  }
  const conflicts: ResearchConflict[] = [];
  for (const [key, entries] of groups) {
    const norms = new Set(entries.map((e) => e.norm));
    if (norms.size < 2) continue;
    entries.sort((a, b) => b.finding.reliability - a.finding.reliability);
    const a = entries[0];
    const b = entries.find((e) => e.norm !== a.norm)!;
    conflicts.push({
      church_id: null,
      field_name: key,
      value_a: a.value,
      source_a: `${hostOf(a.finding.url)} (${a.finding.accessLevel})`,
      value_b: b.value,
      source_b: `${hostOf(b.finding.url)} (${b.finding.accessLevel})`,
      conflict_summary: `Sources disagree on ${key}: "${a.value}" vs "${b.value}". Higher-reliability source preferred but conflict preserved.`,
      recommended_value: a.value,
      confidence: capConfidence(60, a.finding.accessLevel),
      status: 'open',
    });
  }
  return conflicts;
}

function detectContamination(identity: DiscoveryResult): string[] {
  const flags: string[] = [];
  for (const c of identity.candidates) {
    if (c.nameFull && c.cityStatus === 'conflict' && (c.kind === 'official_church' || c.source === 'search')) {
      flags.push(`Same-name church at ${c.host} appears to be in a different city/state (${c.url}) — not this church; do not attribute its facts here.`);
    }
  }
  return [...new Set(flags)];
}

export async function buildDossier(target: ResearchTarget, deps: ResearchDeps): Promise<DossierBuild> {
  const identity = await discoverWebsite({
    name: target.name,
    city: target.city,
    state: target.state,
    originalWebsite: target.originalWebsite,
    originalPhone: null,
    originalEmail: null,
    alternateName: target.alternateName,
  });

  // Effective official site: verified one, else the claimed/original domain
  // (researched via snippets even if its DOM can't be fetched).
  const officialSite = identity.officialSite ?? normalizeUrl(target.originalWebsite);

  const ctx = {
    name: target.name,
    city: target.city,
    state: target.state,
    originalWebsite: target.originalWebsite,
    alternateName: target.alternateName,
    identity,
    officialSite,
    research: deps.research,
  };

  const [website, snippets] = await Promise.all([collectWebsite(ctx), collectSnippets(ctx)]);
  const findings = [...website, ...snippets];

  const conflicts = detectConflicts(findings);
  const contamination = detectContamination(identity);
  const officialCrawled = officialSiteWasCrawled(findings);
  const accessLevel = dossierAccessLevel(findings);
  const facts = extractFacts(findings);

  const { data: synthesis, usage } = await deps.llm.extractJson<DossierSynthesis>({
    system: dossierSynthesisPrompt.system,
    user: dossierSynthesisPrompt.user({
      name: target.name, city: target.city, state: target.state,
      officialSite: identity.officialSite, officialCrawled,
      findings, conflicts, contamination, facts,
    }),
    schema: dossierSynthesisPrompt.schema,
    maxTokens: 2200,
  });

  // Cap every field by its own (or the dossier's) best access level.
  const validLevel = (s?: string): EvidenceAccessLevel | null =>
    s && ['user_provided_ground_truth', 'live_official_site', 'staff_profile', 'social_profile', 'job_posting', 'third_party_directory', 'search_snippets', 'vendor_reference'].includes(s)
      ? (s as EvidenceAccessLevel) : null;

  const fieldEstimates = synthesis.fields.map((f) => {
    const lvl = validLevel(f.access_level) ?? accessLevel;
    return { field_name: f.field_name, value: f.value, confidence: capConfidence(f.confidence, lvl), evidence: f.evidence, access_level: lvl };
  });
  // Deterministic extractions (gap-fill: founded year, campuses, staff count,
  // giving, app, staff contacts) — each capped by its own source access level.
  for (const [k, fact] of Object.entries(facts)) {
    const value = typeof fact.value === 'boolean' ? String(fact.value) : fact.value;
    fieldEstimates.push({ field_name: k, value, confidence: capConfidence(fact.confidence, fact.access_level), evidence: fact.evidence, access_level: fact.access_level });
  }

  const types = new Set(findings.map((f) => f.sourceType)).size;
  const coverage = Math.min(types / 8, 1);
  const research_confidence = capConfidence(
    clamp(coverage * 55 + (officialCrawled ? 25 : 0) + (findings.length >= 5 ? 15 : 5) - conflicts.length * 4),
    accessLevel,
  );

  const dossier: ResearchDossier = {
    church_id: null,
    research_summary: synthesis.research_summary,
    identity_summary: synthesis.identity_summary,
    digital_summary: synthesis.digital_summary,
    staff_summary: synthesis.staff_summary,
    growth_summary: synthesis.growth_summary,
    lifecycle_summary: synthesis.lifecycle_summary,
    evidence_access_level: accessLevel,
    identity_confidence: identity.identity_confidence,
    research_confidence,
    source_count: findings.length,
    official_source_count: findings.filter((f) => f.accessLevel === 'live_official_site' || f.accessLevel === 'staff_profile').length,
    secondary_source_count: findings.filter((f) => f.accessLevel !== 'live_official_site' && f.accessLevel !== 'staff_profile').length,
    conflict_count: conflicts.length,
    contamination_flags: contamination,
  };

  // Strategic fields to persist onto churches.
  const strategic: Partial<Church> = {
    lifecycle_stage: synthesis.lifecycle_stage,
    growth_orientation_score: clamp(synthesis.growth_orientation_score),
    digital_maturity_score: clamp(synthesis.digital_maturity_score),
    change_readiness_score: clamp(synthesis.change_readiness_score),
    staff_depth_score: clamp(synthesis.staff_depth_score),
    evidence_access_level: accessLevel,
    identity_contamination_flag: contamination.length > 0,
    research_confidence,
    church_app_status: synthesis.church_app_status,
    app_provider: synthesis.app_provider,
    online_attendance_estimate: synthesis.online_attendance_estimate,
    online_attendance_confidence: capConfidence(synthesis.online_attendance_confidence, accessLevel),
  };
  // Core fields: only persist when the capped confidence clears the review bar.
  if (identity.officialSite && identity.identityVerdict === 'true_match') strategic.website_verified = identity.officialSite;
  const attConf = capConfidence(synthesis.attendance_confidence, accessLevel);
  if (synthesis.attendance_estimate != null && attConf >= 50) {
    strategic.attendance_estimate = synthesis.attendance_estimate;
    strategic.attendance_min = synthesis.attendance_min;
    strategic.attendance_max = synthesis.attendance_max;
    strategic.attendance_confidence = attConf;
  }

  return {
    identity, findings, conflicts, contamination, synthesis, facts, dossier, strategic,
    fieldEstimates, officialSite, accessLevel, officialCrawled,
    tokens: usage.inputTokens + usage.outputTokens,
    cost: usage.costEstimate,
  };
}
