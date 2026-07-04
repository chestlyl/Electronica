import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Card, Table, Th, Td, Badge, Empty } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/utils";
import { listReviewQueue, supabaseConfigured } from "@/lib/db";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const items = await listReviewQueue("pending");

  return (
    <>
      <PageHeader
        title="Review Queue"
        subtitle="Low-confidence enrichments awaiting approval"
        action={<Badge tone="warn">{fmtNum(items.length)} pending</Badge>}
      />
      <div className="space-y-4 p-6">
        <Card>
          {!supabaseConfigured ? (
            <Empty>Supabase not configured — set env vars in cip-frontend/.env.local.</Empty>
          ) : !items.length ? (
            <Empty>Nothing to review — the queue is clear. 🎉</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Church</Th>
                  <Th>Field</Th>
                  <Th>Current → Proposed</Th>
                  <Th>Confidence</Th>
                  <Th>Evidence</Th>
                  <Th className="w-64">Action</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-border/20">
                    <Td>
                      <Link href={`/churches/${r.church_id}`} className="font-medium text-fg hover:text-accent">
                        {r.churches?.name ?? "Unknown"}
                      </Link>
                      <div className="text-xs text-muted">
                        {[r.churches?.city, r.churches?.state].filter(Boolean).join(", ")}
                      </div>
                    </Td>
                    <Td className="text-muted">{r.field_name}</Td>
                    <Td>
                      <span className="text-muted">{r.current_value ?? "—"}</span>
                      <span className="text-muted"> → </span>
                      <span className="font-medium text-fg">{r.proposed_value ?? "—"}</span>
                    </Td>
                    <Td className="tabular">{fmtPct(r.confidence_score)}</Td>
                    <Td className="max-w-xs text-xs text-muted">
                      <div className="line-clamp-3">{r.evidence_summary ?? "—"}</div>
                      {r.source_urls?.length ? (
                        <a href={r.source_urls[0]} target="_blank" rel="noreferrer" className="text-accent">
                          source
                        </a>
                      ) : null}
                    </Td>
                    <Td>
                      <ReviewActions id={r.id} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
