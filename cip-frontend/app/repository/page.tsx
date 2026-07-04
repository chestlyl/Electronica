import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Card, Table, Th, Td, Badge, ScoreBar, Empty } from "@/components/ui";
import { fmtNum, fmtPct, timeAgo } from "@/lib/utils";
import { listChurches, activeStatusTone, supabaseConfigured, isDemo } from "@/lib/db";
import { RepoFilters } from "./filters";

export const dynamic = "force-dynamic";

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const churches = await listChurches({ q: sp.q, state: sp.state, status: sp.status, limit: 200 });

  return (
    <>
      <PageHeader title="Church Repository" subtitle="Master database of researched churches" />
      <div className="space-y-4 p-6">
        <RepoFilters q={sp.q ?? ""} state={sp.state ?? ""} status={sp.status ?? ""} />

        <Card>
          {!supabaseConfigured && !isDemo ? (
            <Empty>Supabase not configured — set env vars in cip-frontend/.env.local.</Empty>
          ) : !churches.length ? (
            <Empty>No churches match these filters.</Empty>
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-muted">{fmtNum(churches.length)} churches</div>
              <Table>
                <thead>
                  <tr>
                    <Th>Church</Th>
                    <Th>Location</Th>
                    <Th>Status</Th>
                    <Th>Denomination</Th>
                    <Th>Attendance</Th>
                    <Th className="w-40">MMC Fit</Th>
                    <Th>Verified</Th>
                    <Th>Updated</Th>
                  </tr>
                </thead>
                <tbody>
                  {churches.map((c) => (
                    <tr key={c.id} className="group hover:bg-border/20">
                      <Td>
                        <Link href={`/churches/${c.id}`} className="font-medium text-fg group-hover:text-accent">
                          {c.name ?? "Unknown"}
                        </Link>
                        {c.network_affiliation ? (
                          <span className="ml-2 text-xs text-muted">{c.network_affiliation}</span>
                        ) : null}
                      </Td>
                      <Td className="text-muted">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</Td>
                      <Td>
                        {c.active_status ? (
                          <Badge tone={activeStatusTone(c.active_status)}>{c.active_status}</Badge>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </Td>
                      <Td className="text-muted">{c.denomination ?? "—"}</Td>
                      <Td className="tabular">{fmtNum(c.attendance_estimate)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <ScoreBar value={c.mmc_fit_score} className="w-24" />
                          <span className="w-8 text-right text-xs tabular">
                            {c.mmc_fit_score == null ? "—" : Math.round(c.mmc_fit_score)}
                          </span>
                        </div>
                      </Td>
                      <Td className="tabular text-muted">{fmtPct(c.verification_score)}</Td>
                      <Td className="text-xs text-muted">{timeAgo(c.last_checked_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
