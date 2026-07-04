"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/utils/supabase/admin";

/**
 * Select which discovered email a church uses for outreach. Clears the church's
 * other selections, then marks the chosen contact. Status-only (server-side).
 */
export async function setOutreachEmail(
  churchId: string,
  contactId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const clear = await db
      .from("church_contacts")
      .update({ selected_for_outreach: false, updated_at: now })
      .eq("church_id", churchId);
    if (clear.error) return { ok: false, error: clear.error.message };
    const set = await db
      .from("church_contacts")
      .update({ selected_for_outreach: true, updated_at: now })
      .eq("id", contactId);
    if (set.error) return { ok: false, error: set.error.message };
    revalidatePath(`/churches/${churchId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
