import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { Card, Badge, Empty } from "@/components/ui";
import { fmtNum } from "@/lib/utils";
import { getLatestOutreachBatch, approvalTone, hubspotTone, supabaseConfigured, isDemo } from "@/lib/db";
import { OutreachActions } from "./outreach-actions";

export const dynamic = "force-dynamic";

function batchLabel(batchDate: string | null): string {
  if (!batchDate) return "Today's 300";
  const today = new Date().toISOString().slice(0, 10);
  return batchDate === today ? "Today's 300" : `Batch — ${batchDate}`;
}

export default async function OutreachPage() {
  const { batchDate, leads } = await getLatestOutreachBatch();

  return (
    <>
      <PageHeader
        title={batchLabel(batchDate)}
        subtitle="Generated outreach copy · approval · HubSpot sync"
        action={<Badge tone="accent">{fmtNum(leads.length)} leads</Badge>}
      />
      <div className="space-y-4 p-6">
        {!supabaseConfigured && !isDemo ? (
          <Card>
            <Empty>Supabase not configured — set env vars in cip-frontend/.env.local.</Empty>
          </Card>
        ) : !leads.length ? (
          <Card>
            <Empty>
              No outreach batch yet. Rows land in <code className="rounded bg-border/50 px-1">outreach_leads</code> when a
              backend job ranks churches into a daily batch and generates the email copy.
            </Empty>
          </Card>
        ) : (
          <div className="space-y-3">
            {leads.map((l) => (
              <Card key={l.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {l.rank != null ? <span className="text-xs tabular text-muted">#{l.rank}</span> : null}
                      {l.church_id ? (
                        <Link href={`/churches/${l.church_id}`} className="font-medium text-fg hover:text-accent">
                          {l.churches?.name ?? "Church"}
                        </Link>
                      ) : (
                        <span className="font-medium text-fg">{l.churches?.name ?? "Church"}</span>
                      )}
                      <span className="text-xs text-muted">
                        {[l.churches?.city, l.churches?.state].filter(Boolean).join(", ")}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {l.contact_name ? `${l.contact_name} · ` : ""}
                      {l.contact_email ?? "no email"}
                      {l.contact_role ? ` · ${l.contact_role}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={approvalTone(l.approval_status)}>{l.approval_status}</Badge>
                    <Badge tone={hubspotTone(l.hubspot_sync_status)}>HubSpot: {l.hubspot_sync_status}</Badge>
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-border/60 bg-bg/40 p-3">
                  <div className="text-sm font-medium text-fg">{l.subject ?? "(no subject)"}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{l.body ?? "(no body generated)"}</p>
                </div>

                <div className="mt-3">
                  <OutreachActions id={l.id} status={l.approval_status} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
