import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-ONLY Supabase client using the service-role key. This bypasses RLS, so
 * it must never be imported into a Client Component or exposed to the browser.
 * The key is read from SUPABASE_SERVICE_ROLE_KEY (NOT NEXT_PUBLIC_*), so it is
 * only available server-side. Used by the server-component data layer (lib/db.ts)
 * and server actions.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && serviceKey);

let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin() must never run in the browser — it uses the service-role key.");
  }
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in cip-frontend/.env.local.",
    );
  }
  return (_client ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
