import { compareCalibration, type Cell, type FieldMap } from './calibration.js';
import type { CalibrationRow } from './calibrationSet.js';

function n(c: Cell | undefined): number | null {
  if (!c || c.value == null) return null;
  if (typeof c.value === 'number') return c.value;
  const v = parseFloat(String(c.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : null;
}
function val(c: Cell | undefined): string {
  return c && c.value != null && c.value !== '' ? String(c.value) : '—';
}
function withConf(c: Cell | undefined): string {
  if (!c || c.value == null || c.value === '') return '—';
  return c.confidence == null ? String(c.value) : `${c.value} _(${Math.round(c.confidence)})_`;
}

/** Heuristic variance flags computed without ground truth. */
function autoVariance(row: CalibrationRow): string[] {
  const out: string[] = [];
  const f = row.fields;
  if (!row.officialSite) out.push('no official site identified (identity unproven)');
  for (const role of ['lead_pastor', 'executive_pastor', 'operations_leader', 'communications_leader']) {
    if (!f[role]?.value) out.push(`missing contact: ${role}`);
  }
  if (!f.office_email?.value) out.push('missing office email');
  const att = n(f.avg_weekly_attendance);
  if (att == null) out.push('no attendance estimate');
  else if (n(f.avg_weekly_attendance) != null && (row.fields.avg_weekly_attendance?.confidence ?? 0) < 50) out.push('attendance estimate is low-confidence');
  for (const [k, label] of [['digital_maturity_score', 'digital maturity'], ['growth_orientation_score', 'growth'], ['change_readiness_score', 'change readiness'], ['staff_depth_score', 'staff depth']] as const) {
    if (f[k]?.value == null) out.push(`missing ${label} score`);
  }
  if (row.lifecycle.confidence < 50) out.push('lifecycle classification is low-confidence');
  if (row.archetype.confidence < 50) out.push('archetype classification is low-confidence');
  if (row.accessLevel !== 'live_official_site') out.push(`confidence capped — best evidence was ${row.accessLevel}, not the live official site`);
  // Interpreted conclusion capped BELOW its underlying evidence (e.g. live staff
  // evidence outranks the access cap) — surface the loss for calibration.
  const I = row.interpretation;
  const evidenceLeadConf = Math.max(0, ...(row.leadership ?? []).filter((l) => l.isLead).map((l) => l.confidence));
  if (I && I.lead_pastors.value.length && evidenceLeadConf > I.lead_pastors.confidence) {
    out.push(`confidence capped — lead pastor evidence conf ${Math.round(evidenceLeadConf)} reduced to interpreted ${Math.round(I.lead_pastors.confidence)} by the ${row.accessLevel} cap`);
  }
  return out;
}

function rankBlock(title: string, rows: CalibrationRow[], pick: (r: CalibrationRow) => number | null, evidence: (r: CalibrationRow) => string, top = 3, asc = false): string[] {
  const scored = rows.map((r) => ({ r, s: pick(r) })).filter((x) => x.s != null) as { r: CalibrationRow; s: number }[];
  scored.sort((a, b) => (asc ? a.s - b.s : b.s - a.s));
  const lines = [`**${title}**`];
  if (!scored.length) { lines.push('- (insufficient data)'); return lines; }
  for (const { r, s } of scored.slice(0, top)) lines.push(`- ${r.name} (${r.city}, ${r.state}) — ${Math.round(s)} · ${evidence(r)}`);
  return lines;
}

export function renderCalibrationReport(rows: CalibrationRow[], expectations: Record<string, FieldMap>): string {
  const L: string[] = [];
  L.push('# Calibration Report');
  L.push(`_generated ${new Date().toISOString()} · ${rows.length} churches_`);
  L.push('');
  L.push('> Central question: *Would an experienced church strategist trust this dossier enough to decide whether to pursue a relationship with this church?*');
  L.push('> Tool Assessment = what the platform concluded. Human Assessment = blank for you. Variance = where the tool is likely wrong / weak.');
  L.push('');

  // ── set overview ──────────────────────────────────────────────────────
  L.push('## Calibration set');
  L.push('| church | official site | identity | verdict | access | research_conf | archetype | lifecycle |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.name} (${r.city}, ${r.state}) | ${r.officialSite ?? '—'} | ${Math.round(r.identity_confidence)} | ${r.identityVerdict} | ${r.accessLevel} | ${r.research_confidence ?? '—'} | ${r.archetype.value} | ${r.lifecycle.value} |`);
  }
  L.push('');

  // ── cross-church analysis ─────────────────────────────────────────────
  const num = (r: CalibrationRow, k: string) => n(r.fields[k]);
  const mmcProxy = (r: CalibrationRow) => {
    const g = num(r, 'growth_orientation_score'), c = num(r, 'change_readiness_score');
    return g == null && c == null ? null : (g ?? 0) * 0.5 + (c ?? 0) * 0.5;
  };
  const abovWeight = (r: CalibrationRow) => {
    const d = num(r, 'digital_maturity_score'), a = num(r, 'avg_weekly_attendance');
    if (d == null || a == null || a <= 0) return null;
    // digital maturity per 100 attendance — high = punching above weight class
    return d / Math.max(1, Math.log10(a + 10));
  };
  L.push('## Additional analysis (cross-church)');
  L.push('_All proxies are derived from existing dossier fields; "MMC-ready" is a transparent proxy (growth + change readiness), NOT the platform mmc_fit score._');
  L.push('');
  L.push(...rankBlock('Most ready for Million Member Church (proxy)', rows, mmcProxy, (r) => `growth ${val(r.fields.growth_orientation_score)}, change ${val(r.fields.change_readiness_score)}`));
  L.push('');
  L.push(...rankBlock('Least ready for MMC (proxy)', rows, mmcProxy, (r) => `growth ${val(r.fields.growth_orientation_score)}, change ${val(r.fields.change_readiness_score)}`, 3, true));
  L.push('');
  L.push(...rankBlock('Most open to change', rows, (r) => num(r, 'change_readiness_score'), (r) => `lifecycle ${r.lifecycle.value}; ${r.summaries.growth.slice(0, 80)}`));
  L.push('');
  L.push(...rankBlock('Most digitally mature', rows, (r) => num(r, 'digital_maturity_score'), (r) => r.summaries.digital.slice(0, 90)));
  L.push('');
  L.push(...rankBlock('Punching above their weight class (digital ≫ size)', rows, abovWeight, (r) => `digital ${val(r.fields.digital_maturity_score)} at attendance ${val(r.fields.avg_weekly_attendance)}`));
  L.push('');

  // ── per-church ────────────────────────────────────────────────────────
  for (const r of rows) {
    const f = r.fields;
    L.push('---');
    L.push(`## ${r.name} (${r.city ?? ''}, ${r.state ?? ''})`);

    L.push('### Identity');
    L.push(`- input_mode: **${r.inputMode ?? 'market_discovery'}** · provided_url: ${r.providedUrl ?? '—'} · website_verification_status: **${r.websiteVerificationStatus ?? 'not_applicable'}**`);
    L.push(`- official website: **${r.officialSite ?? 'NOT IDENTIFIED'}** · identity_confidence ${Math.round(r.identity_confidence)} · verdict ${r.identityVerdict}`);
    if (r.interpretation?.address.value) L.push(`- address: ${r.interpretation.address.value}`);
    L.push(`- contamination flags: ${r.contaminationFlags.length ? r.contaminationFlags.join('; ') : 'none'}`);
    const c = r.crawl ?? { officialDomFetched: false, renderedDomUsed: false, crawlMethod: 'none', rawTextLength: 0, renderedTextLength: 0, renderedGainRatio: 1, links: [] };
    L.push(`- crawl: official DOM fetched **${c.officialDomFetched ? 'yes' : 'no'}** · rendered DOM used **${c.renderedDomUsed ? 'yes' : 'no'}** (${c.crawlMethod}) · raw_text ${c.rawTextLength} → rendered_text ${c.renderedTextLength} (gain ×${c.renderedGainRatio})`);

    // Per-link crawl trace: why each homepage link was / wasn't crawled, plus any
    // fallback staff/contact probes. Answers "why didn't /staff get fetched?".
    const links = c.links ?? [];
    L.push('#### Crawl link diagnostics');
    if (!links.length) {
      L.push('- _(no homepage links captured — homepage not fetched, or nav is JS-injected and the raw HTML had no <a> links)_');
    } else {
      L.push('| anchor text | resolved URL | category | selected | fetched | text len | staff/contact signal | via |');
      L.push('|---|---|---|---|---|---|---|---|');
      for (const d of links) {
        const anchor = (d.anchorText || '—').slice(0, 28).replace(/\|/g, '/');
        const url = (d.resolvedUrl || d.href || '—').slice(0, 70);
        L.push(`| ${anchor} | ${url} | ${d.category ?? '—'} | ${d.selected ? '✓' : ''} | ${d.fetched ? '✓' : ''} | ${d.textLength || '—'} | ${d.hasStaffContactSignal ? '✓' : ''} | ${d.discovery === 'fallback_probe' ? 'probe' : 'home'} |`);
      }
      const probes = links.filter((d) => d.discovery === 'fallback_probe');
      if (probes.length) L.push(`- fallback staff/contact probes attempted: ${probes.map((p) => p.href).join(', ')}`);
      if (!links.some((d) => d.fetched && d.hasStaffContactSignal)) L.push('- ⚠️ no crawled page contained staff/contact data (email / phone / pastor title)');
      // Staff-page render diagnostics (raw vs rendered text, names/roles detected).
      for (const d of links.filter((x) => x.fetched && (x.category === 'staff' || x.category === 'leadership'))) {
        L.push(`- staff render: ${d.resolvedUrl} — ${d.crawlMethod ?? '—'} · raw_text ${d.rawTextLength ?? '—'} → rendered_text ${d.textLength} (gain ×${d.gainRatio ?? '—'}) · staff_names ${d.staffNames ?? 0} · staff_roles ${d.staffRoles ?? 0}`);
      }
    }

    // ── Coverage checklist (minimum-evidence diagnostic) ──────────────────
    L.push('### Coverage checklist');
    L.push('_Required: homepage, staff/leadership, contact, about. Optional: ministries, giving, sermons, app._');
    const cov = r.coverage ?? [];
    if (!cov.length) { L.push('- _(coverage not recorded)_'); }
    else {
      const tick = (b: boolean) => (b ? '✓' : '✗');
      L.push('| category | required | found | fetched | rendered | useful | note |');
      L.push('|---|---|---|---|---|---|---|');
      for (const c of cov) L.push(`| ${c.category} | ${c.required ? 'yes' : 'no'} | ${tick(c.found)} | ${tick(c.fetched)} | ${tick(c.rendered)} | ${tick(c.useful)} | ${c.note} |`);
      const missingReq = cov.filter((c) => c.required && !c.useful).map((c) => c.category);
      if (missingReq.length) L.push(`- ⚠️ required evidence incomplete: ${missingReq.join(', ')} — strategic scores below are LOW confidence for the affected dimensions.`);
      L.push(`- digital signals → ${r.digitalSummary ?? '—'}`);
    }

    // ── Source coverage (research breadth — did we go beyond the official site?) ─
    const sc = r.sourceCoverage ?? [];
    if (sc.length) {
      L.push('### Source coverage');
      L.push('_Multi-source research breadth — official-site evidence is triangulated, not relied on alone._');
      L.push('| source type | present | count | detail |');
      L.push('|---|---|---|---|');
      for (const s of sc) L.push(`| ${s.category} | ${s.present ? '✓' : '✗'} | ${s.count || (s.present ? '✓' : 0)} | ${s.note} |`);
      const beyond = sc.filter((s) => s.category !== 'official site' && s.present).length;
      L.push(`- breadth: ${beyond}/7 non-official source types present`);
    }

    // ── Technology stack (deterministic hostname mapping) ─────────────────
    const tech = r.techStack ?? [];
    L.push('### Technology stack');
    if (!tech.length) { L.push('- _(no known platform hosts detected)_'); }
    else {
      L.push(`- technology_stack: ${tech.map((t) => t.platform_name).join(', ')}`);
      L.push('| platform | category | confidence | evidence_url |');
      L.push('|---|---|---|---|');
      for (const t of tech) L.push(`| ${t.platform_name} | ${t.category} | ${t.confidence} | ${(t.evidence_url || '—').slice(0, 80)} |`);
    }

    // ── Strategic Signals (deterministic evidence collection — no score change) ─
    const sig = r.strategicSignals ?? [];
    const dim = r.strategicDimensionCounts ?? { digital_maturity: 0, growth_orientation: 0, change_readiness: 0, organizational_capacity: 0, contactability: 0 };
    L.push('### Strategic Signals');
    L.push('_Deterministic evidence collection only (no score change). Sorted website-first (live official site evidence leads)._');
    L.push(`- signals supporting each dimension → digital_maturity **${dim.digital_maturity}** · growth_orientation **${dim.growth_orientation}** · change_readiness **${dim.change_readiness}** · organizational_capacity **${dim.organizational_capacity}** · contactability **${dim.contactability}**`);
    if (!sig.length) { L.push('- _(no strategic signals detected)_'); }
    else {
      L.push('| category | score relevance | anchor text | host | destination URL | source page | confidence |');
      L.push('|---|---|---|---|---|---|---|');
      for (const s of sig) {
        const anchor = (s.anchor_text || '—').slice(0, 24).replace(/\|/g, '/');
        const dest = (s.destination_url || '—').slice(0, 60);
        const src = (s.source_page || '—').slice(0, 50);
        L.push(`| ${s.category} | ${s.dimensions.join(', ') || '—'} | ${anchor} | ${s.host || '—'} | ${dest} | ${src} | ${s.confidence} |`);
      }
    }

    // ── Strategic Scoring v1 (rubric-based, REPORT-ONLY — not written to DB) ───
    const scores = r.strategicScores;
    if (scores) {
      L.push('### Strategic Scoring v1 (rubric)');
      L.push('_Deterministic rubric over interpretation + normalized evidence + strategic signals + tech stack + coverage. Bands: 0–25 weak · 26–50 emerging · 51–75 capable · 76–100 strong. Report-only — not persisted._');
      L.push('| dimension | score | band | confidence | cap | evidence consumed | evidence missing |');
      L.push('|---|---|---|---|---|---|---|');
      for (const d of ['digital_maturity', 'growth_orientation', 'change_readiness', 'organizational_capacity', 'contactability'] as const) {
        const s = scores[d];
        if (!s) continue;
        const consumed = (s.evidenceConsumed.join('; ') || '—').replace(/\|/g, '/').slice(0, 140);
        const missing = (s.evidenceMissing.join(', ') || '—').replace(/\|/g, '/').slice(0, 80);
        const capNote = s.capped ? `capped→${s.confidence} (raw ${s.rawConfidence})` : 'uncapped';
        L.push(`| ${d} | **${s.score}** | ${s.band} | ${Math.round(s.confidence)} | ${capNote} | ${consumed} | ${missing} |`);
      }

      // ── Explainability: per-dimension positive / negative factor breakdown ──
      L.push('');
      L.push('#### Score explainability (why each score — auditable factor breakdown)');
      L.push('_Negative factors are evidence-backed GAP candidates with recommended deductions; they are NOT yet applied to the score (pending calibration)._');
      for (const d of ['digital_maturity', 'growth_orientation', 'change_readiness', 'organizational_capacity', 'contactability'] as const) {
        const s = scores[d];
        if (!s) continue;
        L.push(`- **${d}: ${s.score}** (${s.band})`);
        L.push(`  - Positive factors:`);
        if (!s.positive_factors.length) L.push('    - _(none)_');
        for (const f of s.positive_factors) L.push(`    - ${f.label} (+${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
        L.push(`  - Negative factors (candidate deductions, not applied):`);
        if (!s.negative_factors.length) L.push('    - _(none)_');
        for (const f of s.negative_factors) L.push(`    - ${f.label} (${f.points}) — evidence: ${f.evidence_refs.join(', ')}`);
        const drivers = s.top_factors.map((f) => `${f.label} (+${f.points})`).join(', ');
        L.push(`  - Top drivers: ${drivers || '—'}`);
      }
    }

    // ── Strategic Recommendations (deterministic engine — interpretation-only) ─
    const rec = r.recommendations;
    if (rec) {
      const ev = (refs: { id: string; detail: string }[]) => refs.map((e) => `${e.id} (${e.detail})`).join('; ') || '—';
      L.push('## Strategic Recommendations');
      L.push(`_Deterministic recommendation engine — interpretation-layer inputs only. Overall confidence ${Math.round(rec.confidence)} (evidence ${rec.evidence_refs.length})._`);
      L.push('');
      L.push(`### Engagement Priority\n**${rec.engagement_priority.value.toUpperCase()}** _(conf ${Math.round(rec.engagement_priority.confidence)})_`);
      L.push(`Evidence: ${ev(rec.engagement_priority.evidence_refs)}`);
      L.push(`### Recommended First Conversation\n**${rec.recommended_first_conversation.value}** _(conf ${Math.round(rec.recommended_first_conversation.confidence)})_`);
      L.push(`Evidence: ${ev(rec.recommended_first_conversation.evidence_refs)}`);
      L.push(`### Recommended Entry Point\n**${rec.recommended_entry_point.value}** _(conf ${Math.round(rec.recommended_entry_point.confidence)})_`);
      L.push(`Evidence: ${ev(rec.recommended_entry_point.evidence_refs)}`);
      L.push(`### Likely Pain Points\n${rec.likely_pain_points.value.map((v) => `- ${v}`).join('\n') || '- none'}`);
      L.push(`Evidence: ${ev(rec.likely_pain_points.evidence_refs)}`);
      L.push(`### Likely Growth Constraints\n${rec.likely_growth_constraints.value.map((v) => `- ${v}`).join('\n') || '- none'}`);
      L.push(`Evidence: ${ev(rec.likely_growth_constraints.evidence_refs)}`);
      L.push(`### Recommended Product Fit\n${rec.recommended_product_fit.value.map((v) => `- ${v}`).join('\n') || '- none'}`);
      L.push(`Evidence: ${ev(rec.recommended_product_fit.evidence_refs)}`);
      L.push(`### Partnership Probability\n**${rec.partnership_probability.value}%** _(conf ${Math.round(rec.partnership_probability.confidence)})_`);
      L.push(`Evidence: ${ev(rec.partnership_probability.evidence_refs)}`);
      L.push('### Recommendation Dimensions');
      for (const [k, d] of Object.entries(rec.dimensions)) {
        L.push(`- **${k}**: ${d.level}${d.findings.length ? ` — ${d.findings.join('; ')}` : ''} _(evidence: ${d.evidence_refs.map((e: { id: string }) => e.id).join(', ') || '—'})_`);
      }
      L.push('');
    }

    // ── Evidence layers (Layer 2 raw → Layer 3 normalized → Layer 4 conclusions) ─
    if (r.interpretation) {
      L.push('### Evidence layers');
      L.push(`- raw evidence items: ${r.rawEvidenceCount ?? 0}`);
      if (r.normalizedCounts) {
        const nz = Object.entries(r.normalizedCounts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' · ');
        L.push(`- normalized evidence: ${nz || 'none'}`);
      }
      const I0 = r.interpretation;
      L.push('### Interpretation (conclusions → evidence)');
      L.push('| conclusion | value | confidence | evidence ids | reason |');
      L.push('|---|---|---|---|---|');
      const crow = (label: string, c: { value: unknown; confidence: number; evidence_ids: string[]; reason: string }) =>
        L.push(`| ${label} | ${Array.isArray(c.value) ? (c.value.join('; ') || '—') : (c.value ?? '—')} | ${Math.round(c.confidence)} | ${c.evidence_ids.join(', ') || '—'} | ${(c.reason || '').slice(0, 70).replace(/\|/g, '/')} |`);
      crow('lead_pastors', I0.lead_pastors);
      crow('office_email', I0.office_email);
      crow('office_phone', I0.office_phone);
      crow('lifecycle_stage', I0.lifecycle_stage);
      crow('archetype', I0.archetype);
      crow('contactability', I0.contactability_score);
      L.push(`- known_church_verified: **${I0.known_church_verified}**`);
    }

    L.push('### Contacts');
    // CONCLUSIONS come from the interpretation layer (the SAME object enrich
    // consumes) — the report never re-derives leadership from raw findings.
    const I = r.interpretation;
    const leadNames = I ? I.lead_pastors.value.join('; ') : '';
    const leadConf = I ? Math.round(I.lead_pastors.confidence) : '—';
    const emailVal = I ? (I.office_email.value ?? '—') : val(f.office_email);
    const phoneVal = I ? (I.office_phone.value ?? '—') : val(f.office_phone);
    L.push(`- **Lead pastor(s):** ${leadNames || '—'}${I && I.lead_pastors.evidence_ids.length ? ` _(evidence: ${I.lead_pastors.evidence_ids.join(', ')})_` : ''}`);
    L.push('| role | name | email | phone | confidence |');
    L.push('|---|---|---|---|---|');
    L.push(`| Lead pastor(s) | ${leadNames || '—'} | ${emailVal} | ${phoneVal} | ${leadConf} |`);
    const roleConc = (k: 'executive_pastor' | 'operations_leader' | 'communications_leader', label: string) =>
      `| ${label} | ${I ? (I[k].value ?? '—') : val(f[k])} | — | — | ${I ? (I[k].value ? Math.round(I[k].confidence) : '—') : (f[k]?.confidence != null ? Math.round(f[k]!.confidence!) : '—')} |`;
    L.push(roleConc('executive_pastor', 'Executive pastor'));
    L.push(roleConc('operations_leader', 'Operations leader'));
    L.push(roleConc('communications_leader', 'Communications leader'));
    L.push(`- office email: ${emailVal} · office phone: ${phoneVal} _(church-level, not person-specific)_`);
    // Evidence display: all leader candidates (Layer-3 normalized roster).
    if (r.leadership && r.leadership.length) {
      L.push('- all leaders found: ' + r.leadership.map((l) => `${l.name} (${l.title}${l.isLead ? ', LEAD' : ''})`).join('; '));
    }

    L.push('### Size');
    L.push(`- attendance: **${val(f.avg_weekly_attendance)}** _(conf ${f.avg_weekly_attendance?.confidence != null ? Math.round(f.avg_weekly_attendance.confidence) : '—'})_`);
    L.push(`- online attendance: ${withConf(f.online_attendance_estimate)}`);
    L.push(`- staff count: ${withConf(f.staff_count)} · campus count: ${withConf(f.campus_count)}`);

    L.push('### Strategic');
    L.push('_Score values are synthesized; CONFIDENCE reflects evidence coverage (see checklist)._');
    L.push('| metric | score | confidence | tier | evidence / reason |');
    L.push('|---|---|---|---|---|');
    const notes = r.scoreNotes ?? {};
    for (const [k, label] of [['digital_maturity_score', 'digital maturity'], ['growth_orientation_score', 'growth orientation'], ['change_readiness_score', 'change readiness'], ['staff_depth_score', 'staff depth']] as const) {
      const n = notes[k];
      L.push(`| ${label} | ${val(f[k])} | ${f[k]?.confidence != null ? Math.round(f[k]!.confidence!) : '—'} | ${n?.tier ?? '—'} | ${n?.reason ?? 'synthesized'} |`);
    }
    L.push(`| contactability | ${r.contactability.value} | ${Math.round(r.contactability.confidence)} | ${notes.contactability?.tier ?? '—'} | ${r.contactability.evidence} |`);

    L.push('### Lifecycle');
    L.push(`- **${r.lifecycle.value}** · confidence ${Math.round(r.lifecycle.confidence)} · ${r.lifecycle.evidence}`);

    L.push('### Archetype');
    L.push(`- **${r.archetype.value}** · confidence ${Math.round(r.archetype.confidence)} · ${r.archetype.evidence}`);

    L.push('### Tool Assessment');
    L.push(`${r.summaries.research} ${r.summaries.identity}`);
    if (r.conflicts.length) L.push(`Conflicts preserved: ${r.conflicts.map((c) => `${c.field_name} ("${c.value_a}" vs "${c.value_b}" → ${c.recommended_value})`).join('; ')}.`);

    L.push('### Human Assessment');
    L.push('_(fill in)_');
    L.push('- Correct? ');
    L.push('- Actual lead/exec/ops/comms: ');
    L.push('- Actual attendance / campuses / staff: ');
    L.push('- Actual lifecycle / archetype: ');
    L.push('- Would you pursue a relationship? Y / N — why: ');

    L.push('### Variance');
    const exp = expectations[r.id];
    if (exp && Object.values(exp).some((c) => c.value != null && c.value !== '')) {
      const cmp = compareCalibration(r.fields, {}, exp, r.accessLevel);
      L.push(`- vs expectations → correct: ${cmp.correct.length}, wrong: ${cmp.wrong.length}, missing: ${cmp.missing.length}, overconfident: ${cmp.overconfident.length}`);
      if (cmp.wrong.length) L.push(`  - **incorrect fields**: ${cmp.wrong.join(', ')}`);
      if (cmp.overconfident.length) L.push(`  - **overconfident**: ${cmp.overconfident.join(', ')}`);
      if (cmp.missing.length) L.push(`  - **missing**: ${cmp.missing.join(', ')}`);
    } else {
      L.push('- _(no expectations file — heuristic flags only)_');
    }
    for (const flag of autoVariance(r)) L.push(`  - ⚠️ ${flag}`);
    L.push('');
  }

  return L.join('\n');
}
