import { digitalEvidenceSummary } from './digitalSignals.js';
import { strategicSignalSummary } from './strategicSignals.js';
import { recommendationSummary } from './recommendationEngine.js';
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

  // ── 3. Leadership ───────────────────────────────────────────────────────────
  L.push('## 3. Leadership');
  L.push(`- Lead pastor(s): ${I.lead_pastors.value.join('; ') || '—'}`);
  L.push(`- Executive pastor: ${I.executive_pastor.value ?? '—'} · Operations: ${I.operations_leader.value ?? '—'} · Communications: ${I.communications_leader.value ?? '—'}`);
  L.push(`- Office email: ${I.office_email.value ?? '—'} · Office phone: ${I.office_phone.value ?? '—'}`);
  if (b.leadership?.length) L.push(`- All leaders found: ${b.leadership.map((l) => `${l.name} (${l.title}${l.isLead ? ', LEAD' : ''})`).join('; ')}`);
  L.push('');

  // ── 4. Technology Stack ─────────────────────────────────────────────────────
  L.push('## 4. Technology Stack');
  if (b.techStack?.length) for (const t of b.techStack) L.push(`- ${t.platform_name} (${t.category}) — confidence ${t.confidence}`);
  else L.push('- _(no known platform hosts detected)_');
  L.push('');

  // ── 5. Strategic Signals ────────────────────────────────────────────────────
  L.push('## 5. Strategic Signals');
  L.push(`- ${b.strategicSignals?.length ? strategicSignalSummary(b.strategicSignals) : 'none detected'}`);
  L.push('');

  // ── 6. Strategic Scores (explainable) ───────────────────────────────────────
  if (b.strategicScores) {
    L.push('## 6. Strategic Scores (explainable)');
    L.push('_Score = sum of APPLIED positive factors (each cites evidence). Negative factors are evidence-backed gap candidates with a recommended deduction, NOT yet applied. Bands: 0–25 weak · 26–50 emerging · 51–75 capable · 76–100 strong._');
    for (const d of ['digital_maturity', 'growth_orientation', 'organizational_capacity', 'contactability'] as const) {
      const sc = b.strategicScores[d];
      if (!sc) continue;
      L.push('');
      L.push(`### ${d.replace(/_/g, ' ')}: ${sc.score} (${sc.band})  ·  confidence ${fmtPct(sc.confidence)}${sc.capped ? ` (capped from raw ${sc.rawConfidence})` : ''}`);
      L.push('**Positive factors**');
      if (!sc.positive_factors.length) L.push('- _(none)_');
      for (const f of sc.positive_factors) L.push(`- ${f.label} (+${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
      L.push('**Negative factors** _(candidate deductions — not applied)_');
      if (!sc.negative_factors.length) L.push('- _(none)_');
      for (const f of sc.negative_factors) L.push(`- ${f.label} (${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
      L.push(`**Top drivers:** ${sc.top_factors.map((f) => `${f.label} (+${f.points})`).join(', ') || '—'}`);
    }
    L.push('');
  }

  // ── 7. Strategic Recommendations ────────────────────────────────────────────
  if (b.recommendations) {
    const r = b.recommendations;
    const ev = (refs: { id: string }[]) => refs.map((e) => e.id).join(', ') || '—';
    L.push('## 7. Strategic Recommendations');
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
  for (const c of b.contamination) L.push(`- ${c}`);
  L.push('');
  L.push('### Recommended next verification step');
  if (!b.officialCrawled) L.push('- Fetch the official site with a real browser (Playwright) or contact the church directly — the DOM was never retrieved, which caps every estimate here.');
  else if (b.conflicts.length) L.push(`- Resolve the preserved conflict(s) (${b.conflicts.map((c) => c.field_name).join(', ')}) by confirming directly with the church.`);
  else L.push('- Confirm attendance/staff-count by calling the church; inferred numbers remain indirect estimates.');
  L.push('');

  return L.join('\n');
}
