import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Refresh the Supabase auth session on every matched request and propagate the
 * rotated cookies onto the response. Call this from the root `middleware.ts`.
 *
 * IMPORTANT: the `getClaims()` call below is what actually refreshes an expired
 * token — without it the cookies are read but never rotated, so Server
 * Components eventually see a stale/expired session. Do not remove it, and do
 * not run other logic between creating the client and calling it.
 */
export const updateSession = async (request: NextRequest): Promise<NextResponse> => {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Touch the session so an expired access token gets refreshed and the new
  // cookies land on `supabaseResponse`.
  await supabase.auth.getClaims();

  return supabaseResponse;
};
