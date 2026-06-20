import { discoverWebsite, type DiscoveryResult } from './discovery.js';
import {
  capConfidence,
  dossierAccessLevel,
  officialSiteWasCrawled,
  type SourceFinding,
} from './dossier.js';
import { collectWebsite } from './sources/website.js';
import { collectSnippets } from './sources/snippets.js';
import { extractFacts, aggregateLeadership, debugExtractionTrace, type Facts, type LeaderCandidate } from './extractors.js';
import { detectDigitalSignals, digitalEvidenceSummary, type DigitalSignals } from './digitalSignals.js';
import { computeCoverage, scoreConfidence, contactabilityConfidence, computeSourceCoverage, sourceCoverageSummary, type CoverageRow, type ScoreConfidence, type SourceCoverageRow } from './coverage.js';
import { dossierSynthesisPrompt, type DossierSynthesis } from '../claude/dossierPrompt.js';
import { logger } from '../lib/logger.js';
import type { LlmProvider } from '../claude/client.js';
import type { LinkDiagnostic, ResearchProvider } from './types.js';
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
  leadership: LeaderCandidate[];
  dossier: ResearchDossier;
  strategic: Partial<Church>;
  fieldEstimates: { field_name: string; value: string | number | null; confidence: number; evidence: string; access_level: EvidenceAccessLevel }[];
  officialSite: string | null;
  accessLevel: EvidenceAccessLevel;
  officialCrawled: boolean;
  crawl: CrawlDiagnostics;
  coverage: CoverageRow[];
  sourceCoverage: SourceCoverageRow[];
  digital: DigitalSignals;
  scoreConfidence: Record<string, ScoreConfidence>;
  tokens: number;
  cost: number;
}

export interface CrawlDiagnostics {
  officialDomFetched: boolean;
  renderedDomUsed: boolean;
  crawlMethod: string;
  rawTextLength: number;
  renderedTextLength: number;
  renderedGainRatio: number;
  /** Per-link crawl decision trace from the homepage + fallback probes. */
  links: LinkDiagnostic[];
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

  // Always gather BOTH live-site and snippet evidence. Snippet findings are never
  // discarded just because the homepage fetch succeeded: extractFacts ranks values
  // by reliability × confidence and only considers NON-empty values, so live-site
  // facts win when present, but snippet-sourced contacts survive as a fallback
  // whenever the (possibly thin) official homepage lacks them.
  const [website, snippets] = await Promise.all([collectWebsite(ctx), collectSnippets(ctx)]);
  const findings = [...website, ...snippets];

  const conflicts = detectConflicts(findings);
  const contamination = detectContamination(identity);
  const officialCrawled = officialSiteWasCrawled(findings);
  const accessLevel = dossierAccessLevel(findings);
  const facts = extractFacts(findings);
  // Aggregate ALL pastor/leader candidates (supports co-lead / multiple lead pastors).
  const leadership = aggregateLeadership(findings);

  // Rendered-DOM crawl diagnostics (from the official homepage finding).
  const liveFindings = findings.filter((f) => f.accessLevel === 'live_official_site');
  const homeFinding = liveFindings.find((f) => f.crawlMethod) ?? liveFindings[0];
  const crawl: CrawlDiagnostics = {
    officialDomFetched: officialCrawled,
    renderedDomUsed: liveFindings.some((f) => f.crawlMethod === 'playwright_rendered'),
    crawlMethod: homeFinding?.crawlMethod ?? (officialCrawled ? 'fetch' : 'none'),
    rawTextLength: homeFinding?.rawTextLength ?? 0,
    renderedTextLength: homeFinding?.renderedTextLength ?? 0,
    renderedGainRatio: homeFinding?.renderedGainRatio ?? 1,
    links: liveFindings.find((f) => f.linkDiagnostics)?.linkDiagnostics ?? [],
  };

  // Minimum-evidence coverage + digital-maturity evidence (diagnostic; feeds
  // honest confidence + the synthesis prompt — does not change score formulas).
  const digital = detectDigitalSignals(findings);
  const coverage = computeCoverage(findings, crawl.links, facts, digital);
  const sourceCoverage = computeSourceCoverage(findings, digital);

  const { data: synthesis, usage } = await deps.llm.extractJson<DossierSynthesis>({
    system: dossierSynthesisPrompt.system,
    user: dossierSynthesisPrompt.user({
      name: target.name, city: target.city, state: target.state,
      officialSite: identity.officialSite, officialCrawled, renderedDomUsed: crawl.renderedDomUsed,
      findings, conflicts, contamination, facts, digital: digitalEvidenceSummary(digital),
      sourceCoverage: sourceCoverageSummary(sourceCoverage),
    }),
    schema: dossierSynthesisPrompt.schema,
    maxTokens: 2200,
  });

  // Size fallback: when the deterministic extractors found no staff/campus count,
  // use the synthesis estimate (lower precision, kept as a fact so all downstream
  // consumers — report, enrich, markdown — pick it up).
  if (!facts.staff_count && synthesis.staff_count != null) {
    facts.staff_count = { value: synthesis.staff_count, confidence: synthesis.staff_count_confidence || 40, evidence: 'estimated from indirect signals (synthesis)', source_url: officialSite ?? '', access_level: accessLevel };
  }
  if (!facts.campus_count && synthesis.campus_count != null) {
    facts.campus_count = { value: synthesis.campus_count, confidence: synthesis.campus_count_confidence || 40, evidence: 'estimated from indirect signals (synthesis)', source_url: officialSite ?? '', access_level: accessLevel };
  }

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
  const typeCoverage = Math.min(types / 8, 1);
  const research_confidence = capConfidence(
    clamp(typeCoverage * 55 + (officialCrawled ? 25 : 0) + (findings.length >= 5 ? 15 : 5) - conflicts.length * 4),
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

  // Strategic RESEARCH METADATA — safe to write directly (not church-fact claims
  // subject to the conservative overwrite rules; those go via applyDossierToChurch).
  const strategic: Partial<Church> = {
    lifecycle_stage: synthesis.lifecycle_stage,
    growth_orientation_score: synthesis.growth_orientation_score == null ? null : clamp(synthesis.growth_orientation_score),
    digital_maturity_score: synthesis.digital_maturity_score == null ? null : clamp(synthesis.digital_maturity_score),
    change_readiness_score: synthesis.change_readiness_score == null ? null : clamp(synthesis.change_readiness_score),
    staff_depth_score: synthesis.staff_depth_score == null ? null : clamp(synthesis.staff_depth_score),
    evidence_access_level: accessLevel,
    identity_contamination_flag: contamination.length > 0,
    research_confidence,
    church_app_status: synthesis.church_app_status,
    app_provider: synthesis.app_provider,
    online_attendance_estimate: synthesis.online_attendance_estimate,
    online_attendance_confidence: capConfidence(synthesis.online_attendance_confidence, accessLevel),
  };

  // Coverage-aware confidence for each strategic score (values unchanged).
  const scoreConf: Record<string, ScoreConfidence> = {
    growth_orientation_score: scoreConfidence('growth_orientation_score', coverage, digital),
    digital_maturity_score: scoreConfidence('digital_maturity_score', coverage, digital),
    change_readiness_score: scoreConfidence('change_readiness_score', coverage, digital),
    staff_depth_score: scoreConfidence('staff_depth_score', coverage, digital),
    contactability: contactabilityConfidence(coverage),
  };

  // ── TEMPORARY INSTRUMENTATION (DOSSIER_DEBUG) — trace where contacts vanish ──
  if (process.env.DOSSIER_DEBUG) {
    logger.info(`\n══ DOSSIER_DEBUG: ${target.name} ══`);
    logger.info('— per-finding extraction trace (regex-over-text vs finding.fields) —');
    for (const l of debugExtractionTrace(findings)) logger.info(l);
    logger.info('— build.facts (the ONLY source for report/enrich office_email & office_phone) —');
    logger.info(`  facts.lead_pastor  = ${facts.lead_pastor?.value ?? '—'}`);
    logger.info(`  facts.office_email = ${facts.office_email?.value ?? '—'}`);
    logger.info(`  facts.office_phone = ${facts.office_phone?.value ?? '—'}`);
    logger.info('— synthesis (Claude) — report lead_pastor = synthesis.lead_pastor ?? facts.lead_pastor —');
    logger.info(`  synthesis.lead_pastor = ${JSON.stringify(synthesis.lead_pastor)}`);
    logger.info('— fetched page text (first 2000 chars each) —');
    for (const f of findings.filter((x) => x.fetched)) {
      logger.info(`  ▼ ${f.url} (textLen=${(f.text ?? '').length})\n${(f.text ?? '').slice(0, 2000)}\n  ▲`);
    }
  }

  return {
    identity, findings, conflicts, contamination, synthesis, facts, leadership, dossier, strategic,
    fieldEstimates, officialSite, accessLevel, officialCrawled, crawl, coverage, sourceCoverage, digital, scoreConfidence: scoreConf,
    tokens: usage.inputTokens + usage.outputTokens,
    cost: usage.costEstimate,
  };
}
