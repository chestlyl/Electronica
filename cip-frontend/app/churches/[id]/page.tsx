'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, CardHeader, Badge, Button, ScoreBar, Spinner, Empty, Section, priorityTone } from '@/components/ui';
import { fmtNum, fmtPct } from '@/lib/utils';
import type { ScoredDimension, LeadershipEntry, TechItem, SignalItem, RawEvidenceItem } from '@/lib/types';
import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCORE_ORDER = ['digital_maturity', 'growth_orientation', 'organizational_capacity', 'contactability'] as const;
const label = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-sm"><span className="text-muted">{k}</span><span className="text-right text-fg">{v ?? '—'}</span></div>;
}

function ScoreCard({ dim }: { dim: ScoredDimension }) {
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label(dim.dimension)}</span>
        <span className="text-2xl font-semibold tabular">{dim.score}</span>
      </div>
      <ScoreBar value={dim.score} className="my-2" />
      <div className="flex justify-between text-xs text-muted"><span>{dim.band}</span><span>conf {fmtPct(dim.confidence)}</span></div>
      {dim.positive_factors?.length ? (
        <div className="mt-3 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Positive factors</div>
          {dim.positive_factors.slice(0, 6).map((f, i) => (
            <div key={i} className="flex justify-between gap-2 text-xs"><span className="truncate text-fg">{f.label}</span><span className="text-success">+{f.points}</span></div>
          ))}
        </div>
      ) : null}
      {dim.negative_factors?.length ? (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Verified absent</div>
          {dim.negative_factors.slice(0, 4).map((f, i) => <div key={i} className="truncate text-xs text-muted">{f.label}</div>)}
        </div>
      ) : null}
      {dim.not_investigated?.length ? (
        <div className="mt-2 text-[11px] text-muted">Not investigated: {dim.not_investigated.map((f) => f.label).join(', ')}</div>
      ) : null}
    </Card>
  );
}

function List({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-sm text-muted">—</span>;
  return <ul className="list-disc space-y-1 pl-4 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

export default function ChurchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const church = useQuery({ queryKey: ['church', id], queryFn: () => api.church(id) });
  const dossier = useQuery({ queryKey: ['dossier', id], queryFn: () => api.dossier(id), retry: 0 });

  if (church.isLoading) return <Spinner label="Loading church…" />;
  if (church.error || !church.data) return <div className="p-6"><Card><Empty>Church not found.</Empty></Card></div>;
  const c = church.data;
  const d = dossier.data;
  const cov = (d?.coverage ?? {}) as any;
  const size = (d?.size ?? {}) as any;
  const rec = (d?.recommendations ?? {}) as any;
  const ci = (d?.staff_emails ?? {}) as any;
  const oi = (d?.outreach_intelligence ?? {}) as any;
  const leadership = (d?.leadership_access ?? []) as LeadershipEntry[];
  const tech = (d?.technology_stack ?? []) as TechItem[];
  const signals = (d?.strategic_signals ?? []) as SignalItem[];
  const scores = (d?.strategic_scores ?? {}) as Record<string, ScoredDimension>;
  const evidence = (d?.raw_evidence ?? []) as RawEvidenceItem[];

  return (
    <>
      <PageHeader
        title={c.name ?? 'Unknown church'}
        subtitle={[c.city, c.state].filter(Boolean).join(', ') || 'Location unknown'}
        action={<div className="flex items-center gap-2">
          {c.priority ? <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge> : null}
          {c.website ? <a href={c.website} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> Site</Button></a> : null}
        </div>}
      />
      <div className="space-y-5 p-6">
        {/* top strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><div className="text-xs text-muted">Engagement Fit</div><div className="mt-1 text-2xl font-semibold tabular">{rec?.engagement_fit?.value ?? c.engagement_fit ?? '—'}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted">Avg Weekend Attendance</div><div className="mt-1 text-2xl font-semibold tabular">{fmtNum(c.awa)}</div><div className="text-xs text-muted">{c.attendance_source ?? ''}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted">Coverage</div><div className="mt-1 text-2xl font-semibold tabular">{fmtPct(c.coverage_percent)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted">Research Confidence</div><div className="mt-1 text-2xl font-semibold tabular">{fmtPct(c.research_confidence)}</div></Card>
        </div>

        {!d ? <Card><Empty>{dossier.isLoading ? 'Loading dossier…' : 'No dossier yet for this church. Run research to generate one.'}</Empty></Card> : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Identity */}
              <Section title="Identity">
                <KV k="Official website" v={c.website ? <a className="text-accent" href={c.website} target="_blank" rel="noreferrer">{c.website}</a> : '—'} />
                <KV k="Verification" v={<span className="inline-flex items-center gap-1.5">{c.verified ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <ShieldAlert className="h-3.5 w-3.5 text-warn" />}{c.verified ? 'Verified' : 'Unverified'}</span>} />
                <KV k="Denomination" v={c.denomination} />
                <KV k="Archetype" v={c.archetype} />
                <KV k="Lifecycle" v={c.lifecycle} />
                <KV k="Campuses" v={size?.campuses} />
              </Section>

              {/* Size */}
              <Section title="Church Size">
                <KV k="Average Weekend Attendance" v={fmtNum(c.awa)} />
                <KV k="Range" v={size?.range?.min != null ? `${fmtNum(size.range.min)}–${fmtNum(size.range.max)}` : '—'} />
                <KV k="Attendance source" v={c.attendance_source} />
                <KV k="Attendance confidence" v={fmtPct(size?.attendance_confidence)} />
                <KV k="Staff count" v={size?.staff_count} />
                {size?.reasoning ? <p className="mt-2 text-xs text-muted">{size.reasoning}</p> : null}
              </Section>
            </div>

            {/* Coverage */}
            <Section title={`Coverage — ${fmtPct(cov?.coveragePercent)}`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><div className="mb-1 text-xs font-medium text-success">Complete</div><div className="flex flex-wrap gap-1">{(cov?.complete ?? []).map((x: string) => <Badge key={x} tone="success">{x}</Badge>)}</div></div>
                <div><div className="mb-1 text-xs font-medium text-warn">Partial</div><div className="flex flex-wrap gap-1">{(cov?.partial ?? []).map((x: string) => <Badge key={x} tone="warn">{x}</Badge>)}</div></div>
                <div><div className="mb-1 text-xs font-medium text-muted">Missing</div><div className="flex flex-wrap gap-1">{(cov?.missing ?? []).map((x: string) => <Badge key={x} tone="muted">{x}</Badge>)}</div></div>
              </div>
            </Section>

            {/* Strategic Scores */}
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted">Strategic Scores</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {SCORE_ORDER.filter((k) => scores[k]).map((k) => <ScoreCard key={k} dim={scores[k]} />)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Leadership */}
              <Section title="Leadership Access">
                {leadership.length ? (
                  <div className="divide-y divide-border/60">
                    {leadership.map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="truncate text-xs text-muted">{p.role}{p.title ? ` · ${p.title}` : ''}</div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="text-accent">{p.email ?? 'no email'}</div>
                          <div className="text-muted">conf {p.confidence}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No leadership extracted</Empty>}
              </Section>

              {/* Contact Intelligence */}
              <Section title="Contact Intelligence">
                <KV k="Primary email" v={ci?.primary_email} />
                <KV k="Primary phone" v={ci?.primary_phone} />
                {[
                  ['Church-level', ci?.church_emails], ['Role-based', ci?.role_emails],
                  ['Person-matched', ci?.person_emails], ['Unassigned', ci?.unassigned_emails],
                ].map(([t, rows]) => (rows as any[])?.length ? (
                  <div key={t as string} className="mt-2">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{t as string}</div>
                    <div className="flex flex-wrap gap-1">{(rows as any[]).map((e, i) => <Badge key={i} tone="default">{e.value}</Badge>)}</div>
                  </div>
                ) : null)}
                {ci?.phones?.length ? <div className="mt-2 text-xs text-muted">Phones: {ci.phones.map((p: any) => p.value).join(' · ')}</div> : null}
              </Section>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Technology */}
              <Section title="Technology Stack">
                {tech.length ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {tech.map((t, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                        <div><div className="text-sm">{t.platform_name}</div><div className="text-xs text-muted">{t.category}</div></div>
                        <Badge tone="accent">{t.confidence}</Badge>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No platforms detected</Empty>}
              </Section>

              {/* Signals */}
              <Section title="Strategic Signals">
                {signals.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set(signals.map((s) => s.category))).map((cat) => <Badge key={cat} tone="default">{cat.replace(/_/g, ' ')}</Badge>)}
                  </div>
                ) : <Empty>No signals</Empty>}
              </Section>
            </div>

            {/* Recommendations */}
            <Section title="Strategic Recommendations">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <KV k="Engagement priority" v={c.priority ? <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge> : rec?.engagement_priority?.value} />
                  <KV k="First conversation" v={rec?.recommended_first_conversation?.value} />
                  <KV k="Entry point" v={rec?.recommended_entry_point?.value} />
                  <KV k="Partnership probability" v={rec?.partnership_probability?.value != null ? `${rec.partnership_probability.value}%` : '—'} />
                </div>
                <div className="space-y-3">
                  <div><div className="text-xs font-medium text-muted">Product fit</div><List items={rec?.recommended_product_fit?.value ?? []} /></div>
                  <div><div className="text-xs font-medium text-muted">Likely growth constraints</div><List items={rec?.likely_growth_constraints?.value ?? []} /></div>
                </div>
              </div>
              {oi?.message_angle ? <p className="mt-3 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-sm"><span className="font-medium text-accent">Angle: </span>{oi.message_angle}</p> : null}
            </Section>

            {/* Evidence Explorer */}
            <Section title={`Evidence Explorer — ${evidence.length} sources`}>
              <div className="max-h-96 space-y-1.5 overflow-y-auto">
                {evidence.map((e) => (
                  <a key={e.id} href={e.source_url} target="_blank" rel="noreferrer" className="block rounded-md border border-border/60 px-3 py-2 hover:bg-border/20">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-accent">{e.source_url}</span>
                      <Badge tone="muted">{e.access_level}</Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">{e.text_excerpt}</div>
                  </a>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </>
  );
}
