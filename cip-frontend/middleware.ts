import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

/** Keep the Supabase session fresh on every request (except static assets). */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico and common image types
     * Adjust to include any path that needs an authenticated session.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
