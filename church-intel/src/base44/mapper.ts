import { buildOutreachIntel } from '../research/outreachIntel.js';
import type { DossierBuild, ResearchTarget } from '../research/researchAgent.js';
import type { NormalizedRow } from '../research/evidenceModel.js';

/**
 * Map a completed DossierBuild onto the Base44 front-end entity schema. Pure
 * projection — no recompute, no network. Records that don't fit a Base44 enum
 * (e.g. an app/mobile coverage row, a social_media signal) are SKIPPED rather
 * than coerced. child records are returned WITHOUT church_id; the publisher
 * stamps it after the Church record exists.
 */
type Rec = Record<string, unknown>;

export interface Base44Payload {
  church: Rec;
  contacts: Rec[];
  technologies: Rec[];
  signals: Rec[];
  coverage: Rec[];
  scores: Rec[];
  rawEvidence: Rec[];
  job: Rec;
  activity: Rec;
  dedupe: { website: string | null; name: string };
}

const clean = (r: Rec): Rec => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null));
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function numericCampus(v: unknown): number | null {
  return typeof v === 'number' ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

// ── enum mappers ─────────────────────────────────────────────────────────────
function mapArchetype(arch: string, awa: number | null, multi: boolean): string {
  const a = (arch || '').toLowerCase();
  if (/legacy/.test(a)) return 'Legacy Church';
  if (/plant/.test(a)) return 'Church Plant';
  if (awa != null && awa >= 2000) return 'Megachurch';
  if (multi || /multi/.test(a)) return 'Multi-Site';
  if (/network|hub/.test(a)) return 'Network Hub';
  if (awa != null) { if (awa >= 1000) return 'Large Church'; if (awa >= 250) return 'Mid-Size Church'; if (awa >= 1) return 'Small Church'; }
  if (/mega/.test(a)) return 'Megachurch';
  if (/large/.test(a)) return 'Large Church';
  if (/small/.test(a)) return 'Small Church';
  return 'Mid-Size Church';
}
const LIFECYCLE: Record<string, string> = {
  plant: 'Startup', growing: 'Growth', established: 'Established', plateaued: 'Mature',
  relaunch_revitalization: 'Revitalizing', revitalizing: 'Revitalizing', declining: 'Declining',
};
const PRIORITY: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', critical: 'Critical', monitor: 'Monitor' };
const ROLE: Record<string, string> = {
  lead_pastor: 'Lead Pastor', executive_pastor: 'Executive Pastor', operations_leader: 'Operations Leader',
  communications_leader: 'Communications Leader', marketing_director: 'Communications Leader',
  discipleship_pastor: 'Discipleship Leader', groups_leader: 'Groups Leader', nextgen_leader: 'Next Gen Leader',
  campus_pastor: 'Campus Pastor',
};
const EMAIL_TYPE: Record<string, string> = { person: 'Person Matched', role: 'Role-Based', church: 'Church-Level', unassigned: 'Unassigned' };
const TECH: Record<string, string> = {
  chms: 'Church Management', 'church management': 'Church Management', giving: 'Giving', app: 'Mobile App',
  'mobile app': 'Mobile App', mobile: 'Mobile App', streaming: 'Streaming', video: 'Streaming', groups: 'Groups',
  forms: 'Forms', email: 'Email', website: 'Website Platform', 'website platform': 'Website Platform',
};
const SIGNAL: Record<string, string> = {
  jobs_hiring: 'Hiring', school_academy: 'School', residency: 'Residency', network_affiliation: 'Network Affiliation',
  multi_site: 'Multi-Site', podcast: 'Podcast', livestream_video: 'Video', giving: 'Giving',
  volunteer: 'Volunteer Systems', groups: 'Groups Systems',
};
const COVERAGE: Record<string, string> = {
  homepage: 'Homepage', about: 'About', staff: 'Staff', contact: 'Contact', campuses: 'Campuses',
  ministries: 'Ministries', groups: 'Groups', giving: 'Giving', 'sermons/media': 'Sermons', sermons: 'Sermons',
  technology: 'Technology', social: 'Social', 'jobs/careers': 'Jobs', jobs: 'Jobs',
};
const SCORE_TYPE: Record<string, string> = {
  digital_maturity: 'Digital Maturity', growth_orientation: 'Growth Orientation',
  organizational_capacity: 'Organizational Capacity', contactability: 'Contactability',
};
const strength = (c: number): string => (c >= 80 ? 'Strong' : c >= 60 ? 'Moderate' : 'Weak');
const CHAMPION = new Set(['executive_pastor', 'discipleship_pastor', 'operations_leader']);

export function mapDossierToBase44(target: ResearchTarget, build: DossierBuild): Base44Payload {
  const I = build.interpretation;
  const N = build.normalized;
  const ss = build.strategicScores;
  const rec = build.recommendations;
  const awa = I.attendance_estimate.value;
  const campusN = numericCampus(build.facts.campus_count?.value);
  const multi = (campusN ?? 0) >= 2 || build.facts.multi_site?.value === true;
  const verified = build.identity.websiteVerificationStatus === 'verified';

  const church: Rec = clean({
    name: target.name,
    website: build.officialSite,
    city: target.city,
    state: target.state,
    denomination: I.denomination.value,
    awa,
    attendance_source: I.attendance_source,
    campuses: campusN,
    multi_campus: multi,
    archetype: mapArchetype(I.archetype.value, awa, multi),
    lifecycle: LIFECYCLE[I.lifecycle_stage.value],
    verification_status: verified ? 'Verified' : build.officialCrawled ? 'Partially Verified' : 'Unverified',
    coverage_score: build.coverageReport?.coveragePercent,
    research_confidence: build.dossier.research_confidence,
    engagement_priority: PRIORITY[rec?.engagement_priority?.value ?? ''] ?? 'Medium',
    partnership_probability: rec?.partnership_probability?.value,
    status: 'Researched',
    digital_maturity: ss?.digital_maturity?.score,
    growth_orientation: ss?.growth_orientation?.score,
    organizational_capacity: ss?.organizational_capacity?.score,
    contactability: ss?.contactability?.score,
    summary: build.synthesis.research_summary,
    recommended_first_conversation: rec?.recommended_first_conversation?.value,
    recommended_entry_point: rec?.recommended_entry_point?.value,
    likely_pain_points: rec?.likely_pain_points?.value ?? [],
    growth_constraints: rec?.likely_growth_constraints?.value ?? [],
    product_fit: rec?.recommended_product_fit?.value ?? [],
  });

  // ── Contacts: role-holders (person-matched) + remaining email-map buckets ───
  const outreach = ss && rec && build.sizeRelative
    ? buildOutreachIntel({ interpretation: I, normalized: N, scores: ss, recommendations: rec, sizeRelative: build.sizeRelative })
    : null;
  const bestName = outreach?.best_first_contact?.name?.toLowerCase();

  const people = new Map<string, { name: string; title: string; category: string; source_url: string; confidence: number }>();
  const addP = (r: NormalizedRow) => {
    const k = r.value.toLowerCase();
    const ex = people.get(k);
    const ccat = r.category && r.category !== 'staff' ? r.category : ex?.category ?? r.category;
    people.set(k, { name: r.value, title: r.detail ?? ex?.title ?? '', category: ccat, source_url: r.source_url || ex?.source_url || '', confidence: Math.max(r.confidence ?? 0, ex?.confidence ?? 0) });
  };
  N.leaders.forEach(addP);
  N.staff_roster.forEach(addP);
  const emailByPerson = new Map<string, string>();
  for (const e of N.email_map) if (e.category === 'person' && e.detail) emailByPerson.set(e.detail.toLowerCase(), e.value);

  const contacts: Rec[] = [];
  const usedEmails = new Set<string>();
  for (const p of people.values()) {
    const email = emailByPerson.get(p.name.toLowerCase());
    if (email) usedEmails.add(email.toLowerCase());
    contacts.push(clean({
      name: p.name, title: p.title || undefined, role: ROLE[p.category] ?? 'Other',
      email, confidence: Math.round(p.confidence), source_url: p.source_url || undefined,
      is_best_first_contact: bestName ? p.name.toLowerCase() === bestName : undefined,
      is_internal_champion: CHAMPION.has(p.category) || undefined,
      email_type: email ? 'Person Matched' : undefined,
    }));
  }
  for (const e of N.email_map) {
    if (e.category === 'person') {
      if (!emailByPerson.has((e.detail ?? '').toLowerCase()) || !people.has((e.detail ?? '').toLowerCase())) {
        if (!usedEmails.has(e.value.toLowerCase())) { usedEmails.add(e.value.toLowerCase()); contacts.push(clean({ name: e.detail ?? undefined, role: 'Other', email: e.value, email_type: 'Person Matched', confidence: Math.round(e.confidence), source_url: e.source_url || undefined })); }
      }
      continue;
    }
    if (usedEmails.has(e.value.toLowerCase())) continue;
    usedEmails.add(e.value.toLowerCase());
    contacts.push(clean({ name: undefined, role: 'Other', email: e.value, email_type: EMAIL_TYPE[e.category] ?? 'Unassigned', confidence: Math.round(e.confidence), source_url: e.source_url || undefined }));
  }

  // ── Technology ──────────────────────────────────────────────────────────────
  const technologies: Rec[] = [];
  const seenTech = new Set<string>();
  for (const t of build.techStack ?? []) {
    const category = TECH[(t.category ?? '').toLowerCase()];
    if (!category) continue;
    const key = `${category}|${t.platform_name}`.toLowerCase();
    if (seenTech.has(key)) continue;
    seenTech.add(key);
    technologies.push(clean({ category, platform: t.platform_name, confidence: t.confidence, evidence: t.evidence_url }));
  }

  // ── StrategicSignal: aggregate by mapped type, strongest wins ───────────────
  const sigByType = new Map<string, { conf: number; evidence: string; source: string }>();
  for (const s of build.strategicSignals ?? []) {
    const type = SIGNAL[s.category];
    if (!type) continue;
    const ex = sigByType.get(type);
    if (!ex || s.confidence > ex.conf) sigByType.set(type, { conf: s.confidence, evidence: (s.anchor_text || s.host || s.category).slice(0, 160), source: s.destination_url });
  }
  const signals: Rec[] = [...sigByType.entries()].map(([signal_type, v]) => clean({ signal_type, strength: strength(v.conf), evidence: v.evidence, source: v.source }));

  // ── Coverage ─────────────────────────────────────────────────────────────────
  const coverage: Rec[] = [];
  for (const c of build.coverageReport?.categories ?? []) {
    const category = COVERAGE[c.category];
    if (!category) continue;
    coverage.push(clean({ category, status: cap(c.status), notes: c.note }));
  }

  // ── ScoreDetail ──────────────────────────────────────────────────────────────
  const scores: Rec[] = [];
  for (const dim of ['digital_maturity', 'growth_orientation', 'organizational_capacity', 'contactability'] as const) {
    const sc = ss?.[dim];
    if (!sc) continue;
    scores.push(clean({
      score_type: SCORE_TYPE[dim], score: sc.score, confidence: sc.confidence,
      positive_contributors: sc.positive_factors.map((f) => `${f.label} (+${f.points})`),
      negative_contributors: [],
      verified_absence: sc.negative_factors.map((f) => f.label),
      not_investigated: sc.not_investigated.map((f) => f.label),
      missing_evidence_impact: sc.capped ? `Confidence capped at ${sc.confidence} (raw ${sc.rawConfidence}) by evidence access + coverage.` : undefined,
    }));
  }

  // ── RawEvidence (the real evidence: fetched + official, capped) ─────────────
  const rawEvidence: Rec[] = (build.raw ?? [])
    .filter((r) => r.fetched || r.access_level === 'live_official_site')
    .slice(0, 40)
    .map((r) => clean({
      url: r.source_url, page_title: r.page_category,
      facts: [r.text_excerpt?.slice(0, 280)].filter(Boolean),
      signals: (r.outbound_links ?? []).slice(0, 8).map((l) => l.url),
      confidence: r.fetched ? 70 : 45,
    }));

  const job: Rec = {
    church_name: target.name, status: 'Complete', current_stage: 5,
    stages: ['Discovery', 'Extraction', 'Coverage Validation', 'Strategic Scoring', 'Dossier Generation'].map((name) => ({ name, status: 'Complete' })),
    error_message: null,
  };
  const activity: Rec = {
    type: 'research_completed',
    message: `Research completed for ${target.name} — priority ${church.engagement_priority}, fit ${rec?.engagement_fit?.value ?? '—'}/100`,
    church_name: target.name,
  };

  return { church, contacts, technologies, signals, coverage, scores, rawEvidence, job, activity, dedupe: { website: build.officialSite, name: target.name } };
}
