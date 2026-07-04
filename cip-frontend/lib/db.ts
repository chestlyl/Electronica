import { supabaseAdmin, supabaseConfigured } from "@/utils/supabase/admin";

/**
 * Server-side data layer over the existing Supabase schema (churches,
 * church_evidence, review_queue, outreach_leads). Every function is defensive:
 * if Supabase is unconfigured or a query errors, it returns a safe empty result
 * so pages render an empty state instead of crashing. Import only from Server
 * Components / server actions.
 *
 * Preview mode: when CIP_DEMO=1, all reads return rich seeded fixtures (see
 * lib/demo-data.ts) so the entire UI can be explored with no Supabase or keys.
 */

export { supabaseConfigured };

/** Preview mode — serve seeded data instead of querying Supabase. */
export const isDemo = process.env.CIP_DEMO === "1";

export interface ChurchRow {
  id: string;
  original_row_id: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  website_verified: string | null;
  website_original: string | null;
  email_verified: string | null;
  phone_verified: string | null;
  lead_pastor: string | null;
  denomination: string | null;
  network_affiliation: string | null;
  language: string | null;
  active_status: string | null;
  attendance_estimate: number | null;
  attendance_min: number | null;
  attendance_max: number | null;
  attendance_confidence: number | null;
  attendance_confidence_tier: string | null;
  mmc_fit_score: number | null;
  influence_score: number | null;
  multiplication_score: number | null;
  digital_reach_score: number | null;
  verification_score: number | null;
  review_status: string | null;
  notes: string | null;
  last_checked_at: string | null;
  updated_at: string | null;
}

export interface EvidenceRow {
  field_name: string;
  proposed_value: string | null;
  evidence_text: string | null;
  source_url: string | null;
  source_type: string | null;
  confidence_score: number | null;
  checked_at: string | null;
}

interface ChurchRef {
  name: string | null;
  city: string | null;
  state: string | null;
}
export interface ReviewRow {
  id: string;
  church_id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string | null;
  confidence_score: number | null;
  evidence_summary: string | null;
  source_urls: string[] | null;
  review_status: string;
  created_at: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  churches?: ChurchRef | null;
}

export interface ChurchContactRow {
  id: string;
  church_id: string;
  email: string;
  name: string | null;
  role: string | null;
  category: string;
  source_url: string | null;
  confidence: number | null;
  selected_for_outreach: boolean;
}

export interface OutreachRow {
  id: string;
  church_id: string | null;
  batch_date: string;
  rank: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_role: string | null;
  subject: string | null;
  body: string | null;
  approval_status: string;
  hubspot_sync_status: string;
  hubspot_contact_id: string | null;
  fit_score: number | null;
  churches?: ChurchRef | null;
}

const CHURCH_COLS =
  "id, original_row_id, name, city, state, website_verified, website_original, email_verified, phone_verified, lead_pastor, denomination, network_affiliation, language, active_status, attendance_estimate, attendance_min, attendance_max, attendance_confidence, attendance_confidence_tier, mmc_fit_score, influence_score, multiplication_score, digital_reach_score, verification_score, review_status, notes, last_checked_at, updated_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Dashboard ────────────────────────────────────────────────────────────────
export interface DashboardStats {
  total: number;
  enriched: number;
  reviewPending: number;
  outreachReady: number;
}
export const OUTREACH_FIT_THRESHOLD = 60;

export async function getDashboardStats(): Promise<DashboardStats> {
  const empty: DashboardStats = { total: 0, enriched: 0, reviewPending: 0, outreachReady: 0 };
  if (isDemo) return (await import("@/lib/demo-data")).demoStats;
  if (!supabaseConfigured) return empty;
  try {
    const db = supabaseAdmin();
    const head = { count: "exact" as const, head: true };
    const [total, enriched, review, outreach] = await Promise.all([
      db.from("churches").select("id", head),
      db.from("churches").select("id", head).not("last_checked_at", "is", null),
      db.from("review_queue").select("id", head).eq("review_status", "pending"),
      db.from("churches").select("id", head).not("email_verified", "is", null).gte("mmc_fit_score", OUTREACH_FIT_THRESHOLD),
    ]);
    return {
      total: total.count ?? 0,
      enriched: enriched.count ?? 0,
      reviewPending: review.count ?? 0,
      outreachReady: outreach.count ?? 0,
    };
  } catch (e) {
    console.error("getDashboardStats:", (e as Error).message);
    return empty;
  }
}

// ── Churches ─────────────────────────────────────────────────────────────────
export interface ChurchFilters {
  q?: string;
  state?: string;
  status?: string;
  limit?: number;
}
export async function listChurches(f: ChurchFilters = {}): Promise<ChurchRow[]> {
  if (isDemo) {
    const { demoChurches } = await import("@/lib/demo-data");
    const q = f.q?.toLowerCase();
    return demoChurches.filter(
      (c) =>
        (!q || (c.name ?? "").toLowerCase().includes(q)) &&
        (!f.state || (c.state ?? "").toLowerCase() === f.state.toLowerCase()) &&
        (!f.status || c.active_status === f.status),
    );
  }
  if (!supabaseConfigured) return [];
  try {
    const db = supabaseAdmin();
    let query = db
      .from("churches")
      .select(CHURCH_COLS)
      .order("mmc_fit_score", { ascending: false, nullsFirst: false })
      .limit(f.limit ?? 200);
    if (f.q) query = query.ilike("name", `%${f.q}%`);
    if (f.state) query = query.ilike("state", f.state);
    if (f.status) query = query.eq("active_status", f.status);
    const { data, error } = await query;
    if (error) {
      console.error("listChurches:", error.message);
      return [];
    }
    return (data ?? []) as unknown as ChurchRow[];
  } catch (e) {
    console.error("listChurches:", (e as Error).message);
    return [];
  }
}

export async function getChurch(
  id: string,
): Promise<{ church: ChurchRow | null; evidence: EvidenceRow[]; reviews: ReviewRow[] }> {
  const empty = { church: null, evidence: [] as EvidenceRow[], reviews: [] as ReviewRow[] };
  if (isDemo) return (await import("@/lib/demo-data")).demoChurchDetail(id);
  if (!supabaseConfigured) return empty;
  try {
    const db = supabaseAdmin();
    const col = UUID_RE.test(id) ? "id" : "original_row_id";
    const { data: church, error } = await db.from("churches").select(CHURCH_COLS).eq(col, id).maybeSingle();
    if (error || !church) {
      if (error) console.error("getChurch:", error.message);
      return empty;
    }
    const c = church as unknown as ChurchRow;
    const [ev, rv] = await Promise.all([
      db
        .from("church_evidence")
        .select("field_name, proposed_value, evidence_text, source_url, source_type, confidence_score, checked_at")
        .eq("church_id", c.id)
        .order("checked_at", { ascending: false })
        .limit(200),
      db.from("review_queue").select("*").eq("church_id", c.id).order("created_at", { ascending: false }).limit(100),
    ]);
    return {
      church: c,
      evidence: (ev.data ?? []) as unknown as EvidenceRow[],
      reviews: (rv.data ?? []) as unknown as ReviewRow[],
    };
  } catch (e) {
    console.error("getChurch:", (e as Error).message);
    return empty;
  }
}

// ── Church contacts (all discovered emails; one selectable for outreach) ─────
export async function listChurchContacts(churchId: string): Promise<ChurchContactRow[]> {
  if (isDemo) return (await import("@/lib/demo-data")).demoChurchContacts(churchId);
  if (!supabaseConfigured) return [];
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("church_contacts")
      .select("*")
      .eq("church_id", churchId)
      .order("selected_for_outreach", { ascending: false })
      .order("confidence", { ascending: false, nullsFirst: false });
    if (error) {
      console.error("listChurchContacts:", error.message);
      return [];
    }
    return (data ?? []) as unknown as ChurchContactRow[];
  } catch (e) {
    console.error("listChurchContacts:", (e as Error).message);
    return [];
  }
}

// ── Review queue ─────────────────────────────────────────────────────────────
export async function listReviewQueue(status = "pending"): Promise<ReviewRow[]> {
  if (isDemo) {
    const { demoReviews } = await import("@/lib/demo-data");
    return demoReviews.filter((r) => r.review_status === status);
  }
  if (!supabaseConfigured) return [];
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("review_queue")
      .select("*, churches(name, city, state)")
      .eq("review_status", status)
      .order("confidence_score", { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) {
      console.error("listReviewQueue:", error.message);
      return [];
    }
    return (data ?? []) as unknown as ReviewRow[];
  } catch (e) {
    console.error("listReviewQueue:", (e as Error).message);
    return [];
  }
}

// ── Outreach ─────────────────────────────────────────────────────────────────
export async function getLatestOutreachBatch(): Promise<{ batchDate: string | null; leads: OutreachRow[] }> {
  if (isDemo) {
    const { demoOutreach, demoOutreachDate } = await import("@/lib/demo-data");
    return { batchDate: demoOutreachDate, leads: demoOutreach };
  }
  if (!supabaseConfigured) return { batchDate: null, leads: [] };
  try {
    const db = supabaseAdmin();
    const latest = await db
      .from("outreach_leads")
      .select("batch_date")
      .order("batch_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const batchDate = (latest.data?.batch_date as string | undefined) ?? null;
    if (!batchDate) return { batchDate: null, leads: [] };
    const { data, error } = await db
      .from("outreach_leads")
      .select("*, churches(name, city, state)")
      .eq("batch_date", batchDate)
      .order("rank", { ascending: true, nullsFirst: false })
      .limit(300);
    if (error) {
      console.error("getLatestOutreachBatch:", error.message);
      return { batchDate, leads: [] };
    }
    return { batchDate, leads: (data ?? []) as unknown as OutreachRow[] };
  } catch (e) {
    console.error("getLatestOutreachBatch:", (e as Error).message);
    return { batchDate: null, leads: [] };
  }
}

// ── shared UI helpers (server-safe) ──────────────────────────────────────────
export type BadgeTone = "default" | "accent" | "success" | "warn" | "danger" | "muted";

export function activeStatusTone(s: string | null | undefined): BadgeTone {
  switch (s) {
    case "Verified Active":
      return "success";
    case "Likely Active":
      return "accent";
    case "Uncertain":
      return "warn";
    case "Closed":
      return "danger";
    case "Merged":
      return "muted";
    default:
      return "default";
  }
}
export function approvalTone(s: string | null | undefined): BadgeTone {
  switch (s) {
    case "approved":
      return "success";
    case "sent":
      return "accent";
    case "rejected":
      return "danger";
    case "pending":
      return "warn";
    default:
      return "muted";
  }
}
export function hubspotTone(s: string | null | undefined): BadgeTone {
  switch (s) {
    case "synced":
      return "success";
    case "queued":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "muted";
  }
}
