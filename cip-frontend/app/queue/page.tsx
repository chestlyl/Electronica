'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, Table, Th, Td, Badge, Button, Progress, Spinner, Empty, jobTone, cn } from '@/components/ui';
import { fmtPct, timeAgo } from '@/lib/utils';
import type { JobStatus } from '@/lib/types';

const TABS: { key: JobStatus; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'complete', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];
const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued', discovery: 'Identity / Crawl', extraction: 'Extraction',
  coverage_validation: 'Contact Intelligence', scoring: 'Strategic Scoring',
  dossier_generation: 'Dossier Generation', complete: 'Complete', failed: 'Failed',
};

export default function QueuePage() {
  const [tab, setTab] = useState<JobStatus>('running');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', tab],
    queryFn: () => api.jobs({ status: tab, limit: 100 }),
    refetchInterval: tab === 'running' || tab === 'queued' ? 3_000 : 15_000,
  });
  const retry = useMutation({ mutationFn: (id: string) => api.retryJob(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });

  return (
    <>
      <PageHeader title="Research Queue" subtitle="Monitor active research jobs" />
      <div className="space-y-4 p-6">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn('-mb-px border-b-2 px-4 py-2 text-sm transition-colors', tab === t.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Card>
          {isLoading ? <Spinner /> : !data?.jobs.length ? <Empty>No {tab} jobs</Empty> : (
            <Table>
              <thead><tr>
                <Th>Job</Th><Th>Stage</Th><Th className="w-48">Progress</Th><Th>Status</Th><Th>Started</Th><Th></Th>
              </tr></thead>
              <tbody>
                {data.jobs.map((jb) => (
                  <tr key={jb.job_id} className="hover:bg-border/20">
                    <Td className="font-mono text-xs text-muted">{jb.job_id.slice(0, 16)}…</Td>
                    <Td>{STAGE_LABEL[jb.stage] ?? jb.stage}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Progress value={jb.progress} className="w-32" />
                        <span className="text-xs tabular text-muted">{fmtPct(jb.progress)}</span>
                      </div>
                    </Td>
                    <Td><Badge tone={jobTone(jb.status)}>{jb.status}</Badge>{jb.error ? <div className="mt-1 max-w-xs truncate text-xs text-danger" title={jb.error}>{jb.error}</div> : null}</Td>
                    <Td className="text-xs text-muted">{timeAgo(jb.started_at)}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        {jb.status === 'failed' ? <Button size="sm" onClick={() => retry.mutate(jb.job_id)} disabled={retry.isPending}>Retry</Button> : null}
                        {jb.result?.church_id ? <Link href={`/churches/${jb.result.church_id}`}><Button size="sm" variant="ghost">Open</Button></Link> : null}
                      </div>
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
