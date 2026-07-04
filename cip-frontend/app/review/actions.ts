"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/utils/supabase/admin";

/**
 * Status-only review action. Updates review_queue.review_status (+ reviewed_at +
 * reviewer_notes). It does NOT apply the proposed value to the churches table —
 * that is left to backend jobs. Runs server-side with the service-role key.
 */
export async function setReviewStatus(
  id: string,
  status: "approved" | "rejected",
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = supabaseAdmin();
    const { error } = await db
      .from("review_queue")
      .update({
        review_status: status,
        reviewed_at: new Date().toISOString(),
        reviewer_notes: notes?.trim() || null,
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/review");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
