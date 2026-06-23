import { digitalEvidenceSummary } from './digitalSignals.js';
import { strategicSignalSummary } from './strategicSignals.js';
import { strategicScoreSummary } from './strategicScoring.js';
import { recommendationSummary } from './recommendationEngine.js';
import type { DossierBuild, ResearchTarget } from './researchAgent.js';

function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : String(Math.round(n));
}

export function renderDossierMarkdown(target: ResearchTarget, b: DossierBuild): string {
  const s = b.synthesis;
  const L: string[] = [];
  L.push(`# Research Dossier — ${target.name}`);
  L.push(`_${[target.city, target.state].filter(Boolean).join(', ') || 'location unknown'} · generated ${new Date().toISOString()}_`);
  L.push('');

  // Identity
  L.push('## Identity');
  L.push(`- Official site: **${b.officialSite ?? 'NOT CONFIDENTLY IDENTIFIED'}** (discovery verdict: ${b.identity.identityVerdict}, identity_confidence ${fmtPct(b.identity.identity_confidence)})`);
  L.push(`- Official DOM fetched: **${b.officialCrawled ? 'yes' : 'NO — reconstructed from indexed snippets / third-party sources'}**`);
  L.push(`- Best evidence access level: **${b.accessLevel}** → confidence is capped accordingly`);
  L.push(`- Crawl: official DOM fetched **${b.crawl.officialDomFetched ? 'yes' : 'no'}** · rendered DOM used **${b.crawl.renderedDomUsed ? 'yes' : 'no'}** (${b.crawl.crawlMethod}) · raw_text ${b.crawl.rawTextLength} → rendered_text ${b.crawl.renderedTextLength} (gain ×${b.crawl.renderedGainRatio})`);
  const links = b.crawl.links ?? [];
  if (links.length) {
    L.push('- Crawl link trace (anchor → URL · category · selected/fetched · staff/contact signal):');
    for (const d of links) {
      L.push(`  - ${d.selected ? '◉' : '○'}${d.fetched ? ' fetched' : ''} [${d.category ?? '—'}] "${(d.anchorText || '').slice(0, 30)}" → ${d.resolvedUrl || d.href}${d.fetched ? ` · text ${d.textLength}${d.hasStaffContactSignal ? ' · staff/contact✓' : ''}` : ''}${d.discovery === 'fallback_probe' ? ' · [probe]' : ''}`);
    }
  }
  const covLine = (b.coverage ?? []).map((c) => `${c.category}${c.useful ? '✓' : c.fetched ? '~' : '✗'}`).join(' ');
  if (covLine) L.push(`- Coverage (✓ useful / ~ fetched / ✗ missing): ${covLine}`);
  const srcLine = (b.sourceCoverage ?? []).map((s) => `${s.category}${s.present ? '✓' : '✗'}`).join(' ');
  if (srcLine) L.push(`- Source breadth: ${srcLine}`);
  if (b.digital) L.push(`- Digital signals: ${digitalEvidenceSummary(b.digital)}`);
  if (b.techStack?.length) L.push(`- Technology stack: ${b.techStack.map((t) => `${t.platform_name} (${t.category})`).join(', ')}`);
  if (b.strategicSignals?.length) L.push(`- Strategic signals: ${strategicSignalSummary(b.strategicSignals)}`);
  if (b.strategicScores) L.push(`- Strategic scoring v1 (rubric, report-only): ${strategicScoreSummary(b.strategicScores)}`);
  if (b.recommendations) L.push(`- Strategic recommendation: ${recommendationSummary(b.recommendations)}`);
  const leadLine = b.interpretation.lead_pastors.value.length ? b.interpretation.lead_pastors.value.join('; ') : '—';
  L.push(`- Lead pastor(s): ${leadLine} · Denomination: ${b.interpretation.denomination.value ?? '—'} · Lifecycle: **${b.interpretation.lifecycle_stage.value}**`);
  if (b.interpretation.address.value) L.push(`- Address: ${b.interpretation.address.value}`);
  L.push(`- ${s.identity_summary}`);
  if (!b.officialCrawled) {
    L.push('');
    L.push('> ⚠️ I could not fetch the official website. Findings below come from indexed search snippets and third-party sources, so confidence is **capped**.');
  }
  L.push('');

  // Summaries
  L.push('## Summary');
  L.push(`- **Research:** ${s.research_summary}`);
  L.push(`- **Digital:** ${s.digital_summary}`);
  L.push(`- **Staff:** ${s.staff_summary}`);
  L.push(`- **Growth:** ${s.growth_summary}`);
  L.push(`- **Lifecycle:** ${s.lifecycle_summary}`);
  L.push('');

  // Sources
  L.push(`## Sources used (${b.findings.length})`);
  L.push('| source type | access level | reliability | fetched | url |');
  L.push('|---|---|---|---|---|');
  for (const f of b.findings) {
    L.push(`| ${f.sourceType} | ${f.accessLevel} | ${f.reliability.toFixed(2)} | ${f.fetched ? 'yes' : 'snippet'} | ${f.url} |`);
  }
  L.push('');
  L.push(`Source mix: ${b.dossier.official_source_count} official · ${b.dossier.secondary_source_count} secondary · research_confidence **${fmtPct(b.dossier.research_confidence)}**`);
  L.push('');

  // Strategic estimates — VALUES are interpretation conclusions (single source).
  const I = b.interpretation;
  L.push('## Strategic estimates');
  L.push('| field | value | confidence | basis |');
  L.push('|---|---|---|---|');
  const cap = b.accessLevel;
  L.push(`| lifecycle_stage | ${I.lifecycle_stage.value} | ${fmtPct(I.lifecycle_stage.confidence)} | interpretation |`);
  L.push(`| growth_orientation_score | ${fmtPct(I.growth_orientation_score.value)} | ${fmtPct(I.growth_orientation_score.confidence)} | interpretation |`);
  L.push(`| digital_maturity_score | ${fmtPct(I.digital_maturity_score.value)} | ${fmtPct(I.digital_maturity_score.confidence)} | interpretation |`);
  L.push(`| change_readiness_score | ${fmtPct(I.change_readiness_score.value)} | ${fmtPct(I.change_readiness_score.confidence)} | interpretation |`);
  L.push(`| staff_depth_score | ${fmtPct(I.staff_depth_score.value)} | ${fmtPct(I.staff_depth_score.confidence)} | interpretation |`);
  L.push(`| church_app_status | ${s.church_app_status} | — | app-store/site search |`);
  L.push(`| app_provider | ${s.app_provider ?? '—'} | — | — |`);
  L.push(`| attendance_estimate | ${I.attendance_estimate.value ?? '—'} [${s.attendance_min ?? '?'}–${s.attendance_max ?? '?'}] | ${fmtPct(I.attendance_estimate.confidence)} | interpretation |`);
  L.push(`| online_attendance_estimate | ${s.online_attendance_estimate ?? '—'} | ${fmtPct(b.strategic.online_attendance_confidence ?? null)} | capped @ ${cap} |`);
  L.push('');

  // ── Strategic Scoring (explainable, per dimension) ──────────────────────────
  if (b.strategicScores) {
    L.push('## Strategic Scoring (explainable)');
    L.push('_Score = sum of APPLIED positive factors (each cites evidence). Negative factors are evidence-backed gap candidates with a recommended deduction, NOT yet applied (pending calibration). Bands: 0–25 weak · 26–50 emerging · 51–75 capable · 76–100 strong._');
    for (const d of ['digital_maturity', 'growth_orientation', 'change_readiness', 'organizational_capacity', 'contactability'] as const) {
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

  // ── Strategic Recommendations (deterministic, interpretation-only) ──────────
  if (b.recommendations) {
    const r = b.recommendations;
    const ev = (refs: { id: string }[]) => refs.map((e) => e.id).join(', ') || '—';
    L.push('## Strategic Recommendations');
    L.push(`- **Engagement priority:** ${r.engagement_priority.value} _(evidence: ${ev(r.engagement_priority.evidence_refs)})_`);
    L.push(`- **First conversation:** ${r.recommended_first_conversation.value} _(evidence: ${ev(r.recommended_first_conversation.evidence_refs)})_`);
    L.push(`- **Entry point:** ${r.recommended_entry_point.value} _(evidence: ${ev(r.recommended_entry_point.evidence_refs)})_`);
    L.push(`- **Likely growth constraints:** ${r.likely_growth_constraints.value.join(', ') || '—'} _(evidence: ${ev(r.likely_growth_constraints.evidence_refs)})_`);
    L.push(`- **Likely pain points:** ${r.likely_pain_points.value.join(', ') || '—'}`);
    L.push(`- **Product fit:** ${r.recommended_product_fit.value.join(', ') || '—'}`);
    L.push(`- **Partnership probability:** ${r.partnership_probability.value}% · overall confidence ${fmtPct(r.confidence)}`);
    L.push('');
  }

  // Field estimates (from synthesis)
  if (b.fieldEstimates.length) {
    L.push('## Field estimates');
    L.push('| field | value | confidence | access | evidence |');
    L.push('|---|---|---|---|---|');
    for (const f of b.fieldEstimates) {
      L.push(`| ${f.field_name} | ${f.value ?? '—'} | ${fmtPct(f.confidence)} | ${f.access_level} | ${(f.evidence || '').slice(0, 80)} |`);
    }
    L.push('');
  }

  // Conflicts
  L.push(`## Conflicts (${b.conflicts.length})`);
  if (!b.conflicts.length) L.push('- none detected');
  for (const c of b.conflicts) {
    L.push(`- **${c.field_name}**: "${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b}) → recommended **${c.recommended_value}** (conf ${fmtPct(c.confidence)}). ${c.conflict_summary}`);
  }
  L.push('');

  // Contamination
  L.push(`## Contamination flags (${b.contamination.length})`);
  if (!b.contamination.length) L.push('- none detected');
  for (const c of b.contamination) L.push(`- ${c}`);
  L.push('');

  // Known / Unknown
  L.push('## What is known');
  for (const k of s.known) L.push(`- ${k}`);
  L.push('');
  L.push('## What is uncertain');
  for (const u of s.uncertain) L.push(`- ${u}`);
  L.push('');

  // Next step
  L.push('## Recommended next verification step');
  if (!b.officialCrawled) {
    L.push('- Fetch the official site with a real browser (Playwright) or contact the church directly — the DOM was never retrieved, which caps every estimate here.');
  } else if (b.conflicts.length) {
    L.push(`- Resolve the preserved conflict(s) (${b.conflicts.map((c) => c.field_name).join(', ')}) by confirming directly with the church.`);
  } else {
    L.push('- Confirm attendance/budget/staff-count by calling the church; these remain indirect estimates.');
  }
  L.push('');

  return L.join('\n');
}
