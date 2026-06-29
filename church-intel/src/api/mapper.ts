import { renderDossierMarkdown } from '../research/dossierMarkdown.js';
import { buildContactIntel } from '../research/contactIntel.js';
import { buildOutreachIntel } from '../research/outreachIntel.js';
import type { DossierBuild, ResearchTarget } from '../research/researchAgent.js';
import type { NormalizedEvidence } from '../research/evidenceModel.js';
import type { ChurchResearchFields, DossierSections } from './contract.js';

/**
 * Map a completed `DossierBuild` (the agent's output) onto the API contract —
 * the church repository row fields + the structured/markdown dossier sections.
 *
 * This is a pure PROJECTION. It reads the interpretation/normalized layers and
 * the existing deterministic builders (contact intel, outreach intel, dossier
 * markdown) — it does NOT recompute or alter any score, recommendation, or
 * dossier-content rule. Nothing is invented; absent values map to null.
 */

export interface MappedResult {
  church: ChurchResearchFields;
  sections: DossierSections;
}

// Mirror of the dossier's Leadership Access role grouping (read-only projection).
const ROLE_GROUPS: { label: string; cats: string[] }[] = [
  { label: 'Lead Pastor', cats: ['lead_pastor'] },
  { label: 'Executive Pastor', cats: ['executive_pastor'] },
  { label: 'Operations', cats: ['operations_leader'] },
  { label: 'Discipleship / Groups', cats: ['discipleship_pastor', 'groups_leader'] },
  { label: 'Communications / Marketing', cats: ['communications_leader', 'marketing_director'] },
  { label: 'Campus Pastor', cats: ['campus_pastor'] },
  { label: 'Outreach / Missions', cats: ['outreach_missions_leader'] },
  { label: 'NextGen / Family', cats: ['nextgen_leader'] },
];

interface LeadershipAccessEntry {
  role: string;
  name: string;
  title: string;
  email: string | null;
  source_url: string;
  confidence: number;
}

function buildLeadershipAccess(N: NormalizedEvidence): LeadershipAccessEntry[] {
  const peopleByName = new Map<string, { name: string; title: string; category: string; source_url: string; confidence: number }>();
  const addPerson = (name: string, title: string, category: string, source_url: string, confidence: number) => {
    const key = name.toLowerCase();
    const ex = peopleByName.get(key);
    const cat = category && category !== 'staff' ? category : (ex?.category ?? category);
    peopleByName.set(key, { name, title: title || ex?.title || '', category: cat, source_url: source_url || ex?.source_url || '', confidence: Math.max(confidence ?? 0, ex?.confidence ?? 0) });
  };
  for (const l of N.leaders) addPerson(l.value, l.detail ?? '', l.category, l.source_url, l.confidence);
  for (const r of N.staff_roster) addPerson(r.value, r.detail ?? '', r.category, r.source_url, r.confidence);
  const emailByPerson = new Map<string, string>();
  for (const e of N.email_map) if (e.category === 'person' && e.detail) emailByPerson.set(e.detail.toLowerCase(), e.value);

  const out: LeadershipAccessEntry[] = [];
  for (const g of ROLE_GROUPS) {
    for (const p of [...peopleByName.values()].filter((x) => g.cats.includes(x.category))) {
      out.push({
        role: g.label, name: p.name, title: p.title || '',
        email: emailByPerson.get(p.name.toLowerCase()) ?? null,
        source_url: p.source_url || '', confidence: Math.round(p.confidence),
      });
    }
  }
  return out;
}

export function mapDossierBuild(target: ResearchTarget, build: DossierBuild): MappedResult {
  const I = build.interpretation;
  const N = build.normalized;

  const church: ChurchResearchFields = {
    name: target.name,
    city: target.city,
    state: target.state,
    website: build.officialSite,
    verified: build.identity.websiteVerificationStatus === 'verified',
    denomination: I.denomination.value,
    archetype: I.archetype.value,
    lifecycle: I.lifecycle_stage.value,
    awa: I.attendance_estimate.value,
    attendance_source: I.attendance_source,
    coverage_percent: build.coverageReport?.coveragePercent ?? null,
    research_confidence: build.dossier.research_confidence,
    engagement_fit: build.recommendations?.engagement_fit?.value ?? null,
    priority: build.recommendations?.engagement_priority?.value ?? null,
  };

  const contact = buildContactIntel({ findings: build.contactFindings ?? build.findings, normalized: N, interpretation: I, contaminatedHosts: build.contaminationSources?.hosts });
  const outreach = build.recommendations && build.strategicScores && build.sizeRelative
    ? buildOutreachIntel({ interpretation: I, normalized: N, scores: build.strategicScores, recommendations: build.recommendations, sizeRelative: build.sizeRelative })
    : {};

  const sections: DossierSections = {
    identity: {
      official_website: build.officialSite,
      website_verified: church.verified,
      denomination: I.denomination.value,
      address: I.address.value,
      lifecycle: I.lifecycle_stage.value,
      archetype: I.archetype.value,
      known_church_verified: I.known_church_verified,
      identity_confidence: build.identity.identity_confidence,
    },
    coverage: (build.coverageReport ?? {}) as unknown as Record<string, unknown>,
    size: {
      awa: I.attendance_estimate.value,
      attendance_confidence: I.attendance_estimate.confidence,
      attendance_source: I.attendance_source,
      range: I.attendance_range,
      reasoning: I.attendance_reasoning,
      evidence: I.attendance_evidence,
      staff_count: I.staff_count.value,
      campuses: build.facts.campus_count?.value ?? null,
      size_relative: build.sizeRelative ?? null,
    },
    leadership_access: buildLeadershipAccess(N),
    staff_emails: contact as unknown as Record<string, unknown>,
    technology_stack: build.techStack ?? [],
    strategic_signals: build.strategicSignals ?? [],
    strategic_scores: (build.strategicScores ?? {}) as unknown as Record<string, unknown>,
    recommendations: (build.recommendations ?? {}) as unknown as Record<string, unknown>,
    outreach_intelligence: outreach as unknown as Record<string, unknown>,
    raw_evidence: build.raw ?? [],
    markdown: renderDossierMarkdown(target, build),
  };

  return { church, sections };
}
