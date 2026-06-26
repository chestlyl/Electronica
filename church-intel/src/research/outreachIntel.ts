import type { Interpretation, NormalizedEvidence } from './evidenceModel.js';
import type { StrategicScores } from './strategicScoring.js';
import type { RecommendationEngineResult } from './recommendationEngine.js';
import type { SizeRelativeProfile } from './sizeRelative.js';

/**
 * Outreach Intelligence — Stage 4 relationship strategy, derived DETERMINISTICALLY
 * from the interpretation, normalized evidence, and scores. No Claude inference,
 * no invented contacts: every contact comes from the email/leadership map, and
 * every angle cites the evidence that justifies it.
 */

export interface OutreachContact {
  name: string;
  role: string;
  email: string | null;
  source_url: string;
  why: string;
}
export interface OutreachIntel {
  best_first_contact: OutreachContact | null;
  fallback_contact: OutreachContact | null;
  warmest_entry_point: string;
  message_angle: string;
  supporting_evidence: string[];
  risks: string[];
  do_not_lead_with: string[];
}

export interface OutreachInput {
  interpretation: Interpretation;
  normalized: NormalizedEvidence;
  scores: StrategicScores;
  recommendations: RecommendationEngineResult;
  sizeRelative: SizeRelativeProfile;
}

// Seniority ladder for "who to contact first" (lead first, comms last).
const LADDER: { cat: string; role: string; why: string }[] = [
  { cat: 'lead_pastor', role: 'Lead Pastor', why: 'vision owner and ultimate decision-maker' },
  { cat: 'executive_pastor', role: 'Executive Pastor', why: 'operational decision-maker — usually the real champion' },
  { cat: 'discipleship_pastor', role: 'Discipleship Pastor', why: 'owns the ministry outcome; a credible internal champion' },
  { cat: 'groups_leader', role: 'Groups Pastor', why: 'owns the assimilation outcome the product serves' },
  { cat: 'operations_leader', role: 'Operations Leader', why: 'gauges whether the church can carry the lift' },
  { cat: 'campus_pastor', role: 'Campus Pastor', why: 'warm local entry into a specific campus' },
  { cat: 'outreach_missions_leader', role: 'Outreach / Missions', why: 'aligns with a growth/movement angle' },
  { cat: 'marketing_director', role: 'Marketing / Digital', why: 'executes the work — support, not the driver' },
  { cat: 'communications_leader', role: 'Communications', why: 'executes the work — must NOT own the initiative' },
];

export function buildOutreachIntel(input: OutreachInput): OutreachIntel {
  const { interpretation: I, normalized: N, scores, recommendations: R, sizeRelative: SR } = input;

  // people (leaders ∪ roster) deduped, with role category; emails from the person bucket.
  const people = new Map<string, { name: string; title: string; category: string; source_url: string }>();
  for (const r of [...N.leaders, ...N.staff_roster]) {
    const k = r.value.toLowerCase();
    const ex = people.get(k);
    const cat = r.category && r.category !== 'staff' ? r.category : ex?.category ?? r.category;
    people.set(k, { name: r.value, title: r.detail ?? ex?.title ?? '', category: cat, source_url: r.source_url || ex?.source_url || '' });
  }
  const emailByPerson = new Map<string, string>();
  for (const e of N.email_map) if (e.category === 'person' && e.detail) emailByPerson.set(e.detail.toLowerCase(), e.value);

  const contactFor = (cat: string, role: string, why: string): OutreachContact | null => {
    const p = [...people.values()].find((x) => x.category === cat);
    if (!p) return null;
    return { name: p.name, role, email: emailByPerson.get(p.name.toLowerCase()) ?? null, source_url: p.source_url, why };
  };
  const ranked = LADDER.map((l) => contactFor(l.cat, l.role, l.why)).filter((c): c is OutreachContact => c != null);
  // Prefer the most senior contact we can actually REACH (has an email); else most senior.
  const reachable = ranked.filter((c) => c.email);
  const best_first_contact = reachable[0] ?? ranked[0] ?? null;
  const fallback_contact = ranked.find((c) => c.name !== best_first_contact?.name) ?? null;

  // warmest entry point
  let warmest_entry_point: string;
  if (best_first_contact?.email) warmest_entry_point = `Direct email to ${best_first_contact.name} (${best_first_contact.role}) at ${best_first_contact.email}`;
  else if (I.office_email.value) warmest_entry_point = `Office email (${I.office_email.value}) addressed to ${best_first_contact?.name ?? 'the lead pastor'}`;
  else if (best_first_contact) warmest_entry_point = `Named ${best_first_contact.role} (${best_first_contact.name}) — no email found; use the site contact form / phone`;
  else warmest_entry_point = 'No named leader reachable — general office contact form / social DM';

  // message angle + supporting evidence (from the dominant strategic posture)
  const ev: string[] = [];
  const awa = I.attendance_estimate.value;
  let message_angle: string;
  if (SR?.modernization_opportunity) {
    message_angle = "Digital modernization at scale — they've outgrown their systems.";
    ev.push(SR.summary, `digital_maturity ${scores.digital_maturity.score} vs ~${SR.size_expectation} expected at AWA ${awa}`);
  } else if (scores.growth_orientation.score >= 70 && /plant|growing|relaunch|multipl/i.test(I.lifecycle_stage.value + I.archetype.value)) {
    message_angle = 'Leadership pipeline / multiplication support for a multiplying church.';
    ev.push(`growth_orientation ${scores.growth_orientation.score}`, `lifecycle ${I.lifecycle_stage.value}`, `archetype ${I.archetype.value}`);
  } else if (/revitaliz|plateau|declin/i.test(I.lifecycle_stage.value + I.archetype.value)) {
    message_angle = 'Revitalization partnership — practical next steps for renewed momentum.';
    ev.push(`lifecycle ${I.lifecycle_stage.value}`, `archetype ${I.archetype.value}`);
  } else if (scores.organizational_capacity.score < 45) {
    message_angle = 'Right-sized systems for a lean team — capacity-appropriate, not enterprise scope.';
    ev.push(`organizational_capacity ${scores.organizational_capacity.score}`, awa != null ? `AWA ~${awa}` : 'size unconfirmed');
  } else {
    message_angle = 'Discipleship / engagement systems aligned to their current ministry priorities.';
    ev.push(`growth_orientation ${scores.growth_orientation.score}`, `organizational_capacity ${scores.organizational_capacity.score}`);
  }
  if (R.recommended_product_fit.value.length) ev.push(`product fit: ${R.recommended_product_fit.value.join(', ')}`);

  // risks / sensitivities (evidence-driven)
  const risks: string[] = [];
  if (!I.known_church_verified) risks.push('Identity is unverified — confirm this is the right church/site before any outreach.');
  if (I.attendance_source !== 'reported') risks.push('Attendance is INFERRED, not reported — do not cite a specific number as fact.');
  if (!I.office_email.value && !best_first_contact?.email) risks.push('No verified church email found — outreach path is weak; verify a contact first.');
  const onlyComms = best_first_contact && /communications|marketing/i.test(best_first_contact.role);
  if (onlyComms) risks.push('The most-reachable contact is comms/marketing — they should not own this; route to senior leadership.');
  if (N.email_map.some((e) => e.category === 'unassigned' && /personal/.test(e.detail ?? ''))) risks.push('Some emails found are personal addresses (elders/volunteers) — do not use them as the church contact.');

  // what NOT to lead with
  const dnl: string[] = ['Comms/marketing as the owner — the initiative must be carried by senior leadership.'];
  const digitalMature = R.dimensions.digital_opportunity.level === 'low';
  if (digitalMature) dnl.push("Digital transformation — they're already mature; lead with optimization/partnership instead.");
  if (scores.organizational_capacity.score < 45) dnl.push('Enterprise-scale scope — it will read as too heavy a lift for their capacity.');
  if (/revitaliz|plateau|declin/i.test(I.lifecycle_stage.value + I.archetype.value)) dnl.push('Aggressive growth metrics that may feel out of reach right now.');

  return { best_first_contact, fallback_contact, warmest_entry_point, message_angle, supporting_evidence: ev, risks, do_not_lead_with: dnl };
}
