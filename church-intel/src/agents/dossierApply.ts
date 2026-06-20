import { decideUpdate, confidenceToTier } from '../lib/confidence.js';
import { capConfidence } from '../research/dossier.js';
import { logger } from '../lib/logger.js';
import type { AgentContext } from './base.js';
import type { DossierBuild } from '../research/researchAgent.js';
import type { Church } from '../types.js';

/** Confidence a contact/relationship field must reach to auto-update (rule 4). */
const CONTACT_AUTO_MIN = 90;

/** Strategic research-metadata columns written directly (not church-fact claims). */
const METADATA_FIELDS: (keyof Church)[] = [
  'lifecycle_stage', 'growth_orientation_score', 'digital_maturity_score',
  'change_readiness_score', 'staff_depth_score', 'evidence_access_level',
  'identity_contamination_flag', 'research_confidence', 'church_app_status',
  'app_provider', 'online_attendance_estimate', 'online_attendance_confidence',
];

export interface DossierApplySummary {
  updated: string[];
  review: string[];
  evidenceOnly: string[];
  skipped: string[];
}

/** Write only the safe research-metadata columns directly from the dossier. */
export async function writeResearchMetadata(ctx: AgentContext, churchId: string, build: DossierBuild): Promise<void> {
  const patch: Partial<Church> = {};
  for (const k of METADATA_FIELDS) {
    if (k in build.strategic && (build.strategic as any)[k] !== undefined) (patch as any)[k] = (build.strategic as any)[k];
  }
  await ctx.store.updateChurch(churchId, patch);
}

/** Highest confidence already on record for a field (from prior evidence). */
async function existingConfidence(ctx: AgentContext, churchId: string, field: string): Promise<number | null> {
  const evs = await ctx.store.listEvidence(churchId, field);
  if (!evs.length) return null;
  return Math.max(...evs.map((e) => e.confidence_score ?? 0));
}

/**
 * Conservatively apply the dossier's church-fact fields, honoring:
 *  (1) existing auto-update thresholds, (2) evidence + caps preserved,
 *  (3) never overwrite a higher-confidence existing value,
 *  (4) contact/relationship fields go to review unless confidence is very high.
 */
export async function applyDossierToChurch(ctx: AgentContext, church: Church, build: DossierBuild): Promise<DossierApplySummary> {
  const sum: DossierApplySummary = { updated: [], review: [], evidenceOnly: [], skipped: [] };
  const s = build.synthesis;
  const confOf = (name: string): number | null => {
    const es = build.fieldEstimates.filter((f) => f.field_name === name);
    return es.length ? Math.max(...es.map((e) => e.confidence)) : null;
  };
  const sources = (urls: (string | undefined)[]) => [...new Set(urls.filter((u): u is string => !!u))];

  async function applyField(
    column: keyof Church,
    value: string | number | null,
    confidence: number | null,
    isContact: boolean,
    evidenceText: string,
    sourceUrls: string[],
  ): Promise<void> {
    if (value === null || value === undefined || value === '' || confidence == null) return;
    const conf = capConfidence(confidence, build.accessLevel);
    // (2) always preserve evidence + cap.
    await ctx.store.insertEvidence({
      church_id: church.id, field_name: String(column), proposed_value: String(value),
      evidence_text: evidenceText, source_url: sourceUrls[0] ?? null,
      source_type: 'research_dossier', confidence_score: conf,
    });

    const current = church[column] as unknown;
    const exConf = await existingConfidence(ctx, church.id, String(column));
    // (3) don't overwrite a higher-confidence existing value.
    if (current != null && current !== '' && exConf != null && exConf > conf) {
      sum.skipped.push(`${String(column)} (existing conf ${exConf} > ${conf})`);
      return;
    }

    let decision = decideUpdate(conf);
    // (4) contact fields need very-high confidence to auto-update.
    if (isContact && decision === 'update' && conf < CONTACT_AUTO_MIN) decision = 'review';
    // overwriting an existing value never auto-updates without clearing the bar.
    if (decision === 'update' && current != null && current !== '' && conf < (exConf ?? 0) + 1 && exConf != null) decision = 'review';

    if (decision === 'update') {
      await ctx.store.updateChurch(church.id, { [column]: value } as Partial<Church>);
      sum.updated.push(`${String(column)}=${value} (${conf})`);
    } else if (decision === 'review') {
      await ctx.store.enqueueReview({
        church_id: church.id, field_name: String(column),
        current_value: current == null ? null : String(current), proposed_value: String(value),
        confidence_score: conf, evidence_summary: evidenceText, source_urls: sourceUrls, review_status: 'pending',
      });
      sum.review.push(`${String(column)}=${value} (${conf})`);
    } else {
      sum.evidenceOnly.push(`${String(column)}=${value} (${conf})`);
    }
  }

  const officialUrl = build.officialSite ?? undefined;
  const f = build.facts;
  // CONCLUSIONS come from the interpretation layer — the SAME object the report
  // consumes. Enrich and report can never diverge on leadership/contacts.
  const I = build.interpretation;

  // website (normal): only on a confident identity match.
  if (build.identity.identityVerdict === 'true_match' && build.identity.officialSite) {
    await applyField('website_verified', build.identity.officialSite, build.identity.identity_confidence, false,
      `Identity-verified official site (${build.identity.method})`, sources([build.identity.officialSite]));
  }

  // active status — only when we actually saw the live site (rule: conservative)
  if (build.officialCrawled) {
    await applyField('active_status', 'Verified Active', build.dossier.research_confidence, false,
      'Official website is live and reachable', sources([officialUrl]));
  }

  // denomination (normal) — from interpretation (single source of truth)
  await applyField('denomination', I.denomination.value, I.denomination.value ? (I.denomination.confidence || capConfidence(65, build.accessLevel)) : null, false,
    'Denomination (interpretation)', sources([officialUrl]));

  // contacts/relationships (rule 4 → review unless very high) — from interpretation.
  // Co-lead pastors are preserved (joined), not collapsed to a first match.
  await applyField('lead_pastor', I.lead_pastors.value.length ? I.lead_pastors.value.join('; ') : null,
    I.lead_pastors.value.length ? I.lead_pastors.confidence : null, true,
    `Lead pastor(s) (contact) — evidence ${I.lead_pastors.evidence_ids.join(', ') || 'synthesis'}`, sources([f.lead_pastor?.source_url, officialUrl]));
  await applyField('email_verified', I.office_email.value,
    I.office_email.value ? I.office_email.confidence : null, true,
    'Public office email', sources([f.office_email?.source_url]));
  await applyField('phone_verified', I.office_phone.value,
    I.office_phone.value ? I.office_phone.confidence : null, true,
    'Public office phone', sources([f.office_phone?.source_url]));

  // structure (normal) — staff_count is an INTERPRETATION conclusion.
  await applyField('staff_count', I.staff_count.value,
    I.staff_count.value != null ? I.staff_count.confidence : null, false,
    'Staff count', sources([f.staff_count?.source_url]));
  await applyField('campus_count', (f.campus_count?.value as number) ?? null,
    f.campus_count ? confOf('campus_count') ?? f.campus_count.confidence : null, false,
    'Campus count', sources([f.campus_count?.source_url]));

  // attendance — point estimate + confidence from INTERPRETATION (single source
  // of truth); min/max are sub-components of that conclusion (from synthesis).
  const att = I.attendance_estimate.value;
  if (att != null && s.attendance_min != null && s.attendance_max != null) {
    const conf = capConfidence(I.attendance_estimate.confidence, build.accessLevel);
    const tier = confidenceToTier(conf);
    const evText = `Attendance estimate ${att} [${s.attendance_min}–${s.attendance_max}], tier ${tier}, confidence ${conf} (access ${build.accessLevel}).`;
    await ctx.store.insertEvidence({
      church_id: church.id, field_name: 'attendance_estimate', proposed_value: `${att} [${s.attendance_min}-${s.attendance_max}]`,
      evidence_text: evText, source_url: officialUrl ?? null, source_type: 'research_dossier', confidence_score: conf,
    });
    const decision = decideUpdate(conf);
    if (decision === 'update') {
      await ctx.store.updateChurch(church.id, {
        attendance_estimate: att, attendance_min: s.attendance_min,
        attendance_max: s.attendance_max, attendance_confidence: conf, attendance_confidence_tier: tier,
      });
      sum.updated.push(`attendance_estimate=${att} [${s.attendance_min}-${s.attendance_max}] (${conf})`);
    } else if (decision === 'review') {
      await ctx.store.enqueueReview({
        church_id: church.id, field_name: 'attendance_estimate',
        current_value: church.attendance_estimate == null ? null : String(church.attendance_estimate),
        proposed_value: `${att} [${s.attendance_min}-${s.attendance_max}]`,
        confidence_score: conf, evidence_summary: evText, source_urls: sources([officialUrl]), review_status: 'pending',
      });
      sum.review.push(`attendance_estimate=${att} [${s.attendance_min}-${s.attendance_max}] (${conf})`);
    } else {
      sum.evidenceOnly.push(`attendance_estimate (${conf})`);
    }
  }

  // NOTE: annual_budget is intentionally never written (rule 6) — no column, no
  // extractor; it remains null unless directly evidenced + manually entered.

  logger.info(`  dossier applied — updated: ${sum.updated.length}, review: ${sum.review.length}, evidence-only: ${sum.evidenceOnly.length}, skipped: ${sum.skipped.length}`);
  return sum;
}
