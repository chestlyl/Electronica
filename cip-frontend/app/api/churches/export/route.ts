import { type NextRequest } from "next/server";
import { listChurches } from "@/lib/db";

/**
 * GET /api/churches/export?q=&state=&status= → CSV download of the churches
 * table (honors the Repository filters). Runs server-side via the data layer.
 */
export const dynamic = "force-dynamic";

const COLS = [
  "id", "name", "city", "state", "active_status", "denomination", "network_affiliation",
  "website_verified", "email_verified", "phone_verified", "lead_pastor",
  "attendance_estimate", "mmc_fit_score", "verification_score", "last_checked_at",
];

const cell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const churches = await listChurches({
    q: sp.get("q") ?? undefined,
    state: sp.get("state") ?? undefined,
    status: sp.get("status") ?? undefined,
    limit: 100000,
  });
  const lines = [COLS.join(",")];
  for (const c of churches) lines.push(COLS.map((k) => cell((c as unknown as Record<string, unknown>)[k])).join(","));
  const csv = lines.join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="churches-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
