import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, Badge, Button, ScoreBar, Empty, Section, Table, Th, Td } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/utils";
import { getChurch, listChurchContacts, activeStatusTone } from "@/lib/db";
import { ContactPicker } from "./contact-picker";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right text-fg">{v ?? "—"}</span>
    </div>
  );
}

const SCORES = [
  ["MMC fit", "mmc_fit_score"],
  ["Influence", "influence_score"],
  ["Multiplication", "multiplication_score"],
  ["Digital reach", "digital_reach_score"],
  ["Verification", "verification_score"],
] as const;

export default async function ChurchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { church: c, evidence, reviews } = await getChurch(id);
  const contacts = c ? await listChurchContacts(c.id) : [];

  if (!c) {
    return (
      <>
        <PageHeader title="Church" subtitle="Not found" />
        <div className="p-6">
          <Card>
            <Empty>
              Church not found. <Link href="/repository" className="text-accent">Back to repository</Link>
            </Empty>
          </Card>
        </div>
      </>
    );
  }

  const website = c.website_verified ?? c.website_original;
  const sizeRange =
    c.attendance_min != null && c.attendance_max != null
      ? `${fmtNum(c.attendance_min)}–${fmtNum(c.attendance_max)}`
      : "—";

  return (
    <>
      <PageHeader
        title={c.name ?? "Unknown church"}
        subtitle={[c.city, c.state].filter(Boolean).join(", ") || "Location unknown"}
        action={
          <div className="flex items-center gap-2">
            {c.active_status ? <Badge tone={activeStatusTone(c.active_status)}>{c.active_status}</Badge> : null}
            {website ? (
              <a href={website} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost">
                  <ExternalLink className="h-3.5 w-3.5" /> Site
                </Button>
              </a>
            ) : null}
          </div>
        }
      />
      <div className="space-y-5 p-6">
        {/* top strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted">MMC Fit</div>
            <div className="mt-1 text-2xl font-semibold tabular">
              {c.mmc_fit_score == null ? "—" : Math.round(c.mmc_fit_score)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted">Est. Attendance</div>
            <div className="mt-1 text-2xl font-semibold tabular">{fmtNum(c.attendance_estimate)}</div>
            <div className="text-xs text-muted">{c.attendance_confidence_tier ?? ""}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted">Verification</div>
            <div className="mt-1 text-2xl font-semibold tabular">{fmtPct(c.verification_score)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted">Attendance confidence</div>
            <div className="mt-1 text-2xl font-semibold tabular">{fmtPct(c.attendance_confidence)}</div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Enrichment / identity */}
          <Section title="Enrichment">
            <KV
              k="Website"
              v={website ? <a className="text-accent" href={website} target="_blank" rel="noreferrer">{website}</a> : "—"}
            />
            <KV k="Verified email" v={c.email_verified} />
            <KV k="Verified phone" v={c.phone_verified} />
            <KV k="Lead pastor" v={c.lead_pastor} />
            <KV k="Language" v={c.language} />
            <KV
              k="Status"
              v={c.active_status ? <Badge tone={activeStatusTone(c.active_status)}>{c.active_status}</Badge> : "—"}
            />
          </Section>

          {/* Denomination / network + size */}
          <Section title="Affiliation & Size">
            <KV k="Denomination" v={c.denomination} />
            <KV k="Network affiliation" v={c.network_affiliation} />
            <KV k="Attendance estimate" v={fmtNum(c.attendance_estimate)} />
            <KV k="Attendance range" v={sizeRange} />
            <KV
              k="Confidence"
              v={
                c.attendance_confidence_tier ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-success" />
                    {c.attendance_confidence_tier} · {fmtPct(c.attendance_confidence)}
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </Section>
        </div>

        {/* Contact emails — all discovered, pick one for outreach */}
        <Section title="Contact Emails">
          <ContactPicker churchId={c.id} contacts={contacts} />
        </Section>

        {/* Confidence scores */}
        <Section title="Confidence & Scores">
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {SCORES.map(([label, key]) => {
              const v = c[key] as number | null;
              return (
                <div key={key} className="flex items-center gap-3 py-1">
                  <span className="w-32 shrink-0 text-sm text-muted">{label}</span>
                  <ScoreBar value={v} className="flex-1" />
                  <span className="w-8 text-right text-xs tabular">{v == null ? "—" : Math.round(v)}</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Sources / evidence */}
        <Section title={`Sources — ${evidence.length}`}>
          {evidence.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Field</Th>
                  <Th>Proposed value</Th>
                  <Th>Source</Th>
                  <Th>Type</Th>
                  <Th>Confidence</Th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((e, i) => (
                  <tr key={i} className="hover:bg-border/20">
                    <Td className="text-muted">{e.field_name}</Td>
                    <Td>{e.proposed_value ?? "—"}</Td>
                    <Td>
                      {e.source_url ? (
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="truncate text-accent">
                          {e.source_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-muted">{e.source_type ?? "—"}</Td>
                    <Td className="tabular">{fmtPct(e.confidence_score)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No evidence recorded yet.</Empty>
          )}
        </Section>

        {/* Open review items for this church */}
        {reviews.length ? (
          <Section title={`Review items — ${reviews.length}`}>
            <div className="divide-y divide-border/60">
              {reviews.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="text-muted">{r.field_name}: </span>
                    <span className="text-fg">{r.current_value ?? "—"}</span>
                    <span className="text-muted"> → </span>
                    <span className="text-fg">{r.proposed_value ?? "—"}</span>
                  </div>
                  <Badge tone={r.review_status === "pending" ? "warn" : r.review_status === "approved" ? "success" : "muted"}>
                    {r.review_status}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Notes */}
        <Section title="Notes">
          {c.notes ? <p className="whitespace-pre-wrap text-sm text-fg">{c.notes}</p> : <Empty>No notes.</Empty>}
        </Section>
      </div>
    </>
  );
}
