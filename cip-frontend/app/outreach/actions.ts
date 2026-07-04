"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/utils/supabase/admin";

/**
 * Status-only outreach approval. Updates outreach_leads.approval_status (+
 * updated_at). HubSpot sync + email send are left to backend jobs. Runs
 * server-side with the service-role key.
 */
export async function setOutreachApproval(
  id: string,
  status: "approved" | "rejected",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = supabaseAdmin();
    const { error } = await db
      .from("outreach_leads")
      .update({ approval_status: status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/outreach");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
