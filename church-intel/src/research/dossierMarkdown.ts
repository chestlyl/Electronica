import { digitalEvidenceSummary } from './digitalSignals.js';
import { strategicSignalSummary } from './strategicSignals.js';
import { recommendationSummary } from './recommendationEngine.js';
import { buildOutreachIntel } from './outreachIntel.js';
import { buildContactIntel } from './contactIntel.js';
import type { DossierBuild, ResearchTarget } from './researchAgent.js';

function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : String(Math.round(n));
}

/** Plain-language reason a website failed verification (from the identity note),
 *  surfaced instead of the internal directory/vendor/verdict classification. */
function verificationIssue(b: DossierBuild): string {
  const note = b.identity.note ?? '';
  const m = note.match(/classified (\w+)/i);
  const kind = m?.[1];
  if (kind && kind !== 'official_church') return `provided URL classified as a ${kind.replace(/_/g, ' ')} rather than a church-owned website`;
  const cleaned = note.replace(/^website_unverified:\s*/i, '').split('.')[0].trim();
  return cleaned || 'could not verify the site is owned by this church';
}

export function renderDossierMarkdown(target: ResearchTarget, b: DossierBuild): string {
  const s = b.synthesis;
  const I = b.interpretation;
  const L: string[] = [];
  L.push(`# Research Dossier — ${target.name}`);
  L.push(`_${[target.city, target.state].filter(Boolean).join(', ') || 'location unknown'} · generated ${new Date().toISOString()}_`);
  L.push('');

  // ── 1. Church Identity (trustworthiness, not internal classification) ───────
  const verified = b.identity.websiteVerificationStatus === 'verified';
  L.push('## 1. Church Identity');
  L.push(`- **Official website:** ${b.officialSite ?? 'NOT IDENTIFIED'}`);
  L.push(`- **Website verified:** ${verified ? 'true' : 'false'}`);
  if (!verified && b.officialSite) L.push(`- **Verification issue:** ${verificationIssue(b)}`);
  if (I.denomination.value) L.push(`- Denomination: ${I.denomination.value}`);
  if (I.address.value) L.push(`- Location: ${I.address.value}`);
  L.push(`- Lifecycle: **${I.lifecycle_stage.value}** · Archetype: ${I.archetype.value}`);
  L.push(`- _internal trust:_ known_church_verified ${I.known_church_verified} · identity_confidence ${fmtPct(b.identity.identity_confidence)}`);
  if (!b.officialCrawled) L.push('> ⚠️ Official website DOM was not fetched; evidence is from indexed snippets/third-party sources, so confidence is **capped**.');
  L.push('');

  // ── Coverage Validation — how much of the church did we actually investigate? ─
  if (b.coverageReport) {
    const cr = b.coverageReport;
    L.push(`## Coverage: ${cr.coveragePercent}%`);
    L.push('_What the crawl actually investigated. A `missing`/`partial` category lowers CONFIDENCE — it is not evidence of absence._');
    L.push(`- **Complete (${cr.complete.length}):** ${cr.complete.join(', ') || '—'}`);
    L.push(`- **Partial (${cr.partial.length}):** ${cr.partial.join(', ') || '—'}`);
    L.push(`- **Missing (${cr.missing.length}):** ${cr.missing.join(', ') || '—'}`);
    L.push('| category | status | investigated | note |');
    L.push('|---|---|---|---|');
    for (const c of cr.categories) L.push(`| ${c.category}${c.required ? ' *' : ''} | ${c.status} | ${c.investigated ? 'yes' : 'no'} | ${c.note} |`);
    L.push('');
  }

  // ── 2. Church Size — Average Weekend Attendance is a first-class metric ──────
  const awa = I.attendance_estimate.value;
  const range = I.attendance_range;
  const rangeStr = range.min != null && range.max != null ? ` (range ${range.min}–${range.max})` : '';
  const campuses = b.facts.campus_count?.value ?? '—';
  L.push('## 2. Church Size');
  L.push(`- **Average Weekend Attendance:** ${awa ?? 'unknown'}${rangeStr}`);
  L.push(`- attendance_confidence: ${fmtPct(I.attendance_estimate.confidence)} · attendance_source: **${I.attendance_source}**`);
  L.push(`- staff_count: ${I.staff_count.value ?? 'unknown'} · campuses: ${campuses}`);
  L.push('### Attendance reasoning');
  L.push(`- ${I.attendance_reasoning}`);
  if (I.attendance_evidence.length) {
    L.push('- attendance_evidence:');
    for (const a of I.attendance_evidence) L.push(`  - ${a.factor}: ${a.detail}${a.evidence_ids.length ? ` [${a.evidence_ids.join(', ')}]` : ''}`);
  }
  // Capability-vs-size lens: where capability diverges from what size predicts.
  const sr = b.sizeRelative;
  if (sr && sr.awa != null) {
    L.push('### Capability vs. size');
    L.push(`- posture: **${sr.posture.replace(/_/g, ' ')}** · expected capability ~${sr.size_expectation} at AWA ~${sr.awa}`);
    for (const r of sr.reads) L.push(`  - ${r.dimension.replace(/_/g, ' ')}: ${r.score} vs ~${r.expected} (${r.read}, Δ${r.delta >= 0 ? '+' : ''}${r.delta})`);
    if (sr.modernization_opportunity) L.push('- ⚑ **Modernization opportunity** — large church, digital capability below size expectation.');
    if (sr.above_weight) L.push('- ⚑ **Punching above its weight** — small church with capability beyond its size.');
  }
  L.push('');

  // ── 3. Leadership Access (the relationship-intelligence core) ────────────────
  L.push('## 3. Leadership Access');
  L.push('_The best people to contact, by role, with provenance. "not found" means we have no evidence — never invented._');
  const N = b.normalized;
  // Unified people list (leaders ∪ staff_roster), deduped by name, carrying role.
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

  const ROLE_GROUPS: { label: string; cats: string[]; why: string }[] = [
    { label: 'Lead Pastor', cats: ['lead_pastor'], why: 'Vision owner and ultimate decision-maker; sets whether the church engages at all.' },
    { label: 'Executive Pastor', cats: ['executive_pastor'], why: 'Operational decision-maker — often the real buyer/champion for a systems initiative.' },
    { label: 'Operations', cats: ['operations_leader'], why: 'Owns execution capacity and internal systems; gauges whether they can carry the lift.' },
    { label: 'Discipleship / Groups', cats: ['discipleship_pastor', 'groups_leader'], why: 'Owns the ministry outcome this product serves — a credible, non-comms internal champion.' },
    { label: 'Communications / Marketing', cats: ['communications_leader', 'marketing_director'], why: 'Executes the work but should NOT drive the relationship — support, not the entry point.' },
    { label: 'Campus Pastor', cats: ['campus_pastor'], why: 'Local entry point for a multi-site church; a warm path into a specific campus.' },
    { label: 'Outreach / Missions', cats: ['outreach_missions_leader'], why: 'Signals growth/multiplication orientation; aligns with a movement angle.' },
    { label: 'NextGen / Family', cats: ['nextgen_leader'], why: 'Family/next-gen systems owner; relevant when the angle is the discipleship pipeline.' },
  ];
  let anyAccess = false;
  for (const g of ROLE_GROUPS) {
    const matches = [...peopleByName.values()].filter((p) => g.cats.includes(p.category));
    for (const p of matches) {
      anyAccess = true;
      const email = emailByPerson.get(p.name.toLowerCase()) ?? 'not found';
      L.push(`- **${g.label}: ${p.name}** — ${p.title || '—'}`);
      L.push(`  - email: ${email} · phone: not found · source: ${p.source_url || '—'} · confidence: ${Math.round(p.confidence)}`);
      L.push(`  - why: ${g.why}`);
    }
  }
  if (!anyAccess) L.push('- _(no role-holders extracted — see Staff Emails + roster below)_');
  L.push(`- **Admin / office contact** — email: ${I.office_email.value ?? 'not found'} · phone: ${I.office_phone.value ?? 'not found'}`);
  L.push('');

  // ── 4. Contact Intelligence (every channel preserved, organized for outreach) ─
  const ci = buildContactIntel({ findings: b.findings, normalized: N, interpretation: I, contaminatedHosts: b.contaminationSources?.hosts });
  L.push('## 4. Contact Intelligence');
  L.push('_Every contact channel found, nothing discarded. Emails bucketed: person-matched · role-based · church-level · unassigned. Plus departments, contact forms, campus contacts, and phones._');
  L.push(`- **Primary email:** ${ci.primary_email ?? 'not found'} · **Primary phone:** ${ci.primary_phone ?? 'not found'}`);
  L.push('');
  const bucket = (cat: string) => N.email_map.filter((e) => e.category === cat);
  const emailLines = (label: string, rows: typeof N.email_map, fmt: (e: (typeof rows)[number]) => string) => {
    L.push(`### ${label} (${rows.length})`);
    if (!rows.length) { L.push('- none found'); return; }
    for (const e of rows) L.push(`- ${fmt(e)} _(source: ${e.source_url || '—'}, conf ${Math.round(e.confidence)})_`);
  };
  emailLines('Person-matched', bucket('person'), (e) => `${e.value} → **${e.detail ?? '?'}**`);
  emailLines('Role-based', bucket('role'), (e) => `${e.value}${e.detail ? ` (${e.detail})` : ''}`);
  emailLines('Church-level', bucket('church'), (e) => `${e.value}${e.detail ? ` (${e.detail})` : ''}`);
  emailLines('Unassigned', bucket('unassigned'), (e) => `${e.value}${e.detail ? ` — ${e.detail}` : ''}`);
  // Departments — role mailboxes grouped by the function they serve.
  L.push(`### Department contacts (${ci.departments.length})`);
  if (!ci.departments.length) L.push('- none found');
  for (const d of ci.departments) L.push(`- **${d.department}:** ${d.emails.map((e) => e.value).join(', ')}`);
  // Contact forms — a real "send us a message" form, with the page it lives on.
  L.push(`### Contact forms (${ci.contact_forms.length})`);
  if (!ci.contact_forms.length) L.push('- none detected');
  for (const f of ci.contact_forms) L.push(`- ${f.url} — ${f.evidence}`);
  // Campus / location contacts — address + nearest phone per location.
  L.push(`### Campus / location contacts (${ci.campus_contacts.length})`);
  if (!ci.campus_contacts.length) L.push('- none found');
  for (const c of ci.campus_contacts) L.push(`- **${c.name}** — ${c.address ?? '—'}${c.phone ? ` · ${c.phone}` : ''} _(source: ${c.source_url || '—'})_`);
  // Phones — deduped by number.
  L.push(`### Phones (${ci.phones.length})`);
  if (!ci.phones.length) L.push('- none found');
  for (const p of ci.phones) L.push(`- ${p.value}${p.label ? ` (${p.label})` : ''} _(conf ${p.confidence})_`);
  L.push('');

  // ── 4. Technology Stack ─────────────────────────────────────────────────────
  L.push('## 5. Technology Stack');
  if (b.techStack?.length) for (const t of b.techStack) L.push(`- ${t.platform_name} (${t.category}) — confidence ${t.confidence}`);
  else L.push('- _(no known platform hosts detected)_');
  L.push('');

  // ── 5. Strategic Signals ────────────────────────────────────────────────────
  L.push('## 6. Strategic Signals');
  L.push(`- ${b.strategicSignals?.length ? strategicSignalSummary(b.strategicSignals) : 'none detected'}`);
  L.push('');

  // ── 6. Strategic Scores (explainable) ───────────────────────────────────────
  if (b.strategicScores) {
    L.push('## 7. Strategic Scores (explainable)');
    L.push('_Score = sum of APPLIED positive factors (each cites evidence). Negative factors are evidence-backed gap candidates with a recommended deduction, NOT yet applied. Bands: 0–25 weak · 26–50 emerging · 51–75 capable · 76–100 strong._');
    for (const d of ['digital_maturity', 'growth_orientation', 'organizational_capacity', 'contactability'] as const) {
      const sc = b.strategicScores[d];
      if (!sc) continue;
      L.push('');
      L.push(`### ${d.replace(/_/g, ' ')}: ${sc.score} (${sc.band})  ·  confidence ${fmtPct(sc.confidence)}${sc.capped ? ` (capped from raw ${sc.rawConfidence})` : ''}`);
      L.push('**Positive factors**');
      if (!sc.positive_factors.length) L.push('- _(none)_');
      for (const f of sc.positive_factors) L.push(`- ${f.label} (+${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
      L.push('**Negative factors** _(verified absent — category investigated; candidate deductions, not applied)_');
      if (!sc.negative_factors.length) L.push('- _(none)_');
      for (const f of sc.negative_factors) L.push(`- ${f.label} (${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
      if (sc.not_investigated.length) {
        L.push('**Not investigated** _(category never crawled — affects CONFIDENCE only, NOT a gap)_');
        for (const f of sc.not_investigated) L.push(`- ${f.label}`);
      }
      L.push(`**Top drivers:** ${sc.top_factors.map((f) => `${f.label} (+${f.points})`).join(', ') || '—'}`);
    }
    L.push('');
  }

  // ── 7. Strategic Recommendations ────────────────────────────────────────────
  if (b.recommendations) {
    const r = b.recommendations;
    const ev = (refs: { id: string }[]) => refs.map((e) => e.id).join(', ') || '—';
    L.push('## 8. Strategic Recommendations');
    L.push(`- **Engagement fit:** ${r.engagement_fit.value}/100 — ${r.engagement_fit.reason}`);
    L.push(`- **Engagement priority:** ${r.engagement_priority.value} _(evidence: ${ev(r.engagement_priority.evidence_refs)})_`);
    L.push(`- **First conversation:** ${r.recommended_first_conversation.value} _(evidence: ${ev(r.recommended_first_conversation.evidence_refs)})_`);
    L.push(`- **Entry point:** ${r.recommended_entry_point.value} _(evidence: ${ev(r.recommended_entry_point.evidence_refs)})_`);
    L.push(`- **Likely growth constraints:** ${r.likely_growth_constraints.value.join(', ') || '—'} _(evidence: ${ev(r.likely_growth_constraints.evidence_refs)})_`);
    L.push(`- **Likely pain points:** ${r.likely_pain_points.value.join(', ') || '—'}`);
    L.push(`- **Product fit:** ${r.recommended_product_fit.value.join(', ') || '—'}`);
    L.push(`- **Partnership probability:** ${r.partnership_probability.value}% · overall confidence ${fmtPct(r.confidence)}`);
    L.push('');
  }

  // ── 9. Outreach Intelligence (deterministic relationship strategy) ──────────
  if (b.recommendations && b.strategicScores && b.sizeRelative) {
    const oi = buildOutreachIntel({ interpretation: I, normalized: b.normalized, scores: b.strategicScores, recommendations: b.recommendations, sizeRelative: b.sizeRelative });
    const fmtC = (c: typeof oi.best_first_contact) => c ? `${c.name} (${c.role}) — ${c.email ?? 'email not found'} · ${c.why}` : 'none identified';
    L.push('## 9. Outreach Intelligence');
    L.push(`- **Best first contact:** ${fmtC(oi.best_first_contact)}`);
    L.push(`- **Fallback contact:** ${fmtC(oi.fallback_contact)}`);
    L.push(`- **Warmest entry point:** ${oi.warmest_entry_point}`);
    L.push(`- **Recommended message angle:** ${oi.message_angle}`);
    L.push(`- **Evidence for this angle:** ${oi.supporting_evidence.join('; ') || '—'}`);
    L.push('- **Risks / sensitivities:**');
    for (const x of oi.risks.length ? oi.risks : ['none flagged']) L.push(`  - ${x}`);
    L.push('- **What NOT to lead with:**');
    for (const x of oi.do_not_lead_with) L.push(`  - ${x}`);
    L.push('');
  }

  // ── Appendix — Research diagnostics (implementation details, demoted) ────────
  L.push('## Appendix — Research diagnostics');
  L.push(`- Discovery verdict: ${b.identity.identityVerdict} · input_mode ${b.identity.inputMode} · website_verification_status ${b.identity.websiteVerificationStatus}`);
  L.push(`- Best evidence access level: **${b.accessLevel}** (confidence capped accordingly)`);
  L.push(`- Crawl: official DOM fetched **${b.crawl.officialDomFetched ? 'yes' : 'no'}** · rendered DOM used **${b.crawl.renderedDomUsed ? 'yes' : 'no'}** (${b.crawl.crawlMethod}) · raw_text ${b.crawl.rawTextLength} → rendered_text ${b.crawl.renderedTextLength} (gain ×${b.crawl.renderedGainRatio})`);
  const covLine = (b.coverage ?? []).map((c) => `${c.category}${c.useful ? '✓' : c.fetched ? '~' : '✗'}`).join(' ');
  if (covLine) L.push(`- Coverage (✓ useful / ~ fetched / ✗ missing): ${covLine}`);
  if (b.digital) L.push(`- Digital signals: ${digitalEvidenceSummary(b.digital)}`);
  L.push(`- Source mix: ${b.dossier.official_source_count} official · ${b.dossier.secondary_source_count} secondary · research_confidence **${fmtPct(b.dossier.research_confidence)}**`);
  L.push(`- Recommendation summary: ${b.recommendations ? recommendationSummary(b.recommendations) : '—'}`);
  L.push('');
  L.push('### Sources used');
  L.push('| source type | access level | reliability | fetched | url |');
  L.push('|---|---|---|---|---|');
  for (const f of b.findings) L.push(`| ${f.sourceType} | ${f.accessLevel} | ${f.reliability.toFixed(2)} | ${f.fetched ? 'yes' : 'snippet'} | ${f.url} |`);
  L.push('');
  L.push('### Synthesis summaries');
  L.push(`- **Research:** ${s.research_summary}`);
  L.push(`- **Digital:** ${s.digital_summary}`);
  L.push(`- **Staff:** ${s.staff_summary}`);
  L.push(`- **Growth:** ${s.growth_summary}`);
  L.push(`- **Lifecycle:** ${s.lifecycle_summary}`);
  L.push('');
  L.push(`### Conflicts (${b.conflicts.length})`);
  if (!b.conflicts.length) L.push('- none detected');
  for (const c of b.conflicts) L.push(`- **${c.field_name}**: "${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b}) → recommended **${c.recommended_value}** (conf ${fmtPct(c.confidence)}). ${c.conflict_summary}`);
  L.push('');
  L.push(`### Contamination flags (${b.contamination.length})`);
  if (!b.contamination.length) L.push('- none detected');
  else L.push('_Enforced: evidence from these sources is excluded from Leadership Access, Contact Intelligence, and Outreach Intelligence._');
  for (const c of b.contamination) L.push(`- ${c}`);
  L.push('');
  L.push('### Recommended next verification step');
  if (!b.officialCrawled) L.push('- Fetch the official site with a real browser (Playwright) or contact the church directly — the DOM was never retrieved, which caps every estimate here.');
  else if (b.conflicts.length) L.push(`- Resolve the preserved conflict(s) (${b.conflicts.map((c) => c.field_name).join(', ')}) by confirming directly with the church.`);
  else L.push('- Confirm attendance/staff-count by calling the church; inferred numbers remain indirect estimates.');
  L.push('');

  return L.join('\n');
}
