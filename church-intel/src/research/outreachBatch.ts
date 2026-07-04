/**
 * Outreach batch generator — "Today's 300". Ranks outreach-eligible churches
 * and produces draft outreach rows (subject/body/contact) for the outreach_leads
 * table. Pure + dependency-injected: eligibility, ranking, and copy generation
 * are all testable offline. The copy generator is injectable so an LLM-backed
 * writer can replace the deterministic template later.
 *
 * No church record is mutated; this only produces DRAFT leads that a human
 * approves in the UI. Nothing is sent.
 */

export interface OutreachEligibleChurch {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  email_verified: string | null;
  lead_pastor: string | null;
  mmc_fit_score: number | null;
  active_status: string | null;
}

export interface OutreachDraft {
  church_id: string;
  batch_date: string;
  rank: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_role: string;
  subject: string;
  body: string;
  approval_status: "pending";
  hubspot_sync_status: "not_synced";
  fit_score: number | null;
}

export interface OutreachCopy {
  subject: string;
  body: string;
}
export type CopyGenerator = (c: OutreachEligibleChurch) => OutreachCopy;

export interface OutreachBatchOptions {
  batchDate: string; // YYYY-MM-DD — passed in for determinism
  limit?: number; // default 300 ("Today's 300")
  minFit?: number; // default 60
  activeStatuses?: string[]; // default Verified/Likely Active
  excludeChurchIds?: Set<string>; // already in today's batch
  generateCopy?: CopyGenerator; // default: deterministic template
}

export const DEFAULT_LIMIT = 300;
export const DEFAULT_MIN_FIT = 60;
export const DEFAULT_ACTIVE = ["Verified Active", "Likely Active"];

const firstName = (full: string | null | undefined): string | null =>
  (full ?? "").trim().split(/\s+/)[0] || null;

/** Deterministic, non-fabricating outreach copy. Swap for an LLM generator via opts. */
export const defaultCopyTemplate: CopyGenerator = (c) => {
  const name = c.name ?? "your church";
  const greetName = firstName(c.lead_pastor) ?? "there";
  const place = c.city ? ` in ${c.city}${c.state ? `, ${c.state}` : ""}` : "";
  const subject = `A quick idea for ${name}'s next season`;
  const body =
    `Hi ${greetName},\n\n` +
    `${name}${place} stood out to us as we looked at churches doing meaningful work in your area. ` +
    `We help teams like yours turn their existing momentum into measurable next-step engagement. ` +
    `Would a short 15-minute call next week be worth it?\n\n` +
    `— MMC Team`;
  return { subject, body };
};

/** Is a church eligible for outreach this batch? (verified email + fit + active + not already batched) */
export function isEligible(c: OutreachEligibleChurch, opts: OutreachBatchOptions): boolean {
  const minFit = opts.minFit ?? DEFAULT_MIN_FIT;
  const active = opts.activeStatuses ?? DEFAULT_ACTIVE;
  if (!c.email_verified) return false;
  if ((c.mmc_fit_score ?? 0) < minFit) return false;
  if (!active.includes(c.active_status ?? "")) return false;
  if (opts.excludeChurchIds?.has(c.id)) return false;
  return true;
}

/**
 * Build the ranked draft batch. Eligible churches sorted by MMC fit (desc), then
 * name (asc) for a stable order, capped at `limit`, each with generated copy.
 */
export function buildOutreachBatch(
  churches: OutreachEligibleChurch[],
  opts: OutreachBatchOptions,
): OutreachDraft[] {
  const gen = opts.generateCopy ?? defaultCopyTemplate;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const eligible = churches
    .filter((c) => isEligible(c, opts))
    .sort((a, b) => (b.mmc_fit_score ?? 0) - (a.mmc_fit_score ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);

  return eligible.map((c, i) => {
    const { subject, body } = gen(c);
    return {
      church_id: c.id,
      batch_date: opts.batchDate,
      rank: i + 1,
      contact_name: c.lead_pastor ?? null,
      contact_email: c.email_verified,
      contact_role: c.lead_pastor ? "Lead Pastor" : "General",
      subject,
      body,
      approval_status: "pending",
      hubspot_sync_status: "not_synced",
      fit_score: c.mmc_fit_score,
    };
  });
}
