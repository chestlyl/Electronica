'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, CardHeader, Badge, ScoreBar, Spinner, Empty, jobTone, priorityTone } from '@/components/ui';
import { fmtNum, fmtPct, timeAgo } from '@/lib/utils';
import type { ChurchRow } from '@/lib/types';
import { Building2, Loader2, CheckCircle2, Gauge } from 'lucide-react';

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ElementType; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <Icon className={`h-4 w-4 ${tone ?? 'text-muted'}`} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular">{value}</div>
    </Card>
  );
}

function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <Empty>No data yet</Empty>;
  return (
    <div className="space-y-2 p-4">
      {rows.slice(0, 8).map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-muted">{r.label}</div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <div className="w-8 text-right text-xs tabular text-fg">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

function ChurchMiniRow({ c }: { c: ChurchRow }) {
  return (
    <Link href={`/churches/${c.church_id}`} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-sm last:border-0 hover:bg-border/30">
      <div className="min-w-0">
        <div className="truncate font-medium">{c.name ?? 'Unknown'}</div>
        <div className="truncate text-xs text-muted">{[c.city, c.state].filter(Boolean).join(', ') || '—'} · {c.archetype ?? '—'}</div>
      </div>
      <div className="flex items-center gap-3">
        {c.priority ? <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge> : null}
        <div className="w-10 text-right text-xs tabular text-muted">{c.engagement_fit ?? '—'}</div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 20_000 });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Executive overview of platform activity" />
      <div className="space-y-5 p-6">
        {isLoading ? <Spinner /> : error ? <Card><Empty>Could not load stats — is the CIP API running? ({(error as Error).message})</Empty></Card> : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Churches Researched" value={fmtNum(data.total_churches)} icon={Building2} tone="text-accent" />
              <StatCard label="Jobs Running" value={fmtNum(data.jobs_running)} icon={Loader2} tone="text-warn" />
              <StatCard label="Jobs Completed" value={fmtNum(data.jobs_completed)} icon={CheckCircle2} tone="text-success" />
              <StatCard label="Avg Engagement Fit" value={data.avg_engagement_fit == null ? '—' : String(data.avg_engagement_fit)} icon={Gauge} tone="text-accent" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Top Opportunities" subtitle="Highest engagement fit" />
                {data.top_opportunities.length ? data.top_opportunities.map((c) => <ChurchMiniRow key={c.church_id} c={c} />) : <Empty>No churches yet</Empty>}
              </Card>
              <Card>
                <CardHeader title="Recent Dossiers" />
                {data.recent_dossiers.length ? data.recent_dossiers.map((c) => <ChurchMiniRow key={c.church_id} c={c} />) : <Empty>No dossiers yet</Empty>}
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card><CardHeader title="Churches by Archetype" /><BarList rows={data.churches_by_archetype} /></Card>
              <Card><CardHeader title="Churches by State" /><BarList rows={data.churches_by_state} /></Card>
            </div>

            <Card>
              <CardHeader title="Recent Research Activity" />
              {data.recent_activity.length ? (
                <div className="divide-y divide-border/60">
                  {data.recent_activity.map((jb) => (
                    <div key={jb.job_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <Badge tone={jobTone(jb.status)}>{jb.status}</Badge>
                        <span className="text-muted">{jb.stage.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular text-muted">{fmtPct(jb.progress)}</span>
                        <span className="text-xs text-muted">{timeAgo(jb.started_at ?? null)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty>No activity yet</Empty>}
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
