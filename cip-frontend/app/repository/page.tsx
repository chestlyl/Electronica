'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, Table, Th, Td, Input, Badge, ScoreBar, Spinner, Empty, priorityTone } from '@/components/ui';
import { fmtNum, fmtPct, timeAgo } from '@/lib/utils';

export default function RepositoryPage() {
  const [filters, setFilters] = useState({ q: '', state: '', archetype: '', priority: '' });
  const { data, isLoading, error } = useQuery({
    queryKey: ['churches', filters],
    queryFn: () => api.churches({ ...filters, limit: 200 }),
  });

  return (
    <>
      <PageHeader title="Church Repository" subtitle="Master database of researched churches" />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Input placeholder="Search name…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <Input placeholder="State (e.g. TN)" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} />
          <Input placeholder="Archetype" value={filters.archetype} onChange={(e) => setFilters({ ...filters, archetype: e.target.value })} />
          <Input placeholder="Priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} />
        </div>

        <Card>
          {isLoading ? <Spinner /> : error ? <Empty>Could not load — is the CIP API running?</Empty> : !data?.churches.length ? <Empty>No churches match.</Empty> : (
            <>
              <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
                <span>{fmtNum(data.total)} churches</span>
              </div>
              <Table>
                <thead><tr>
                  <Th>Church</Th><Th>Location</Th><Th>Attendance</Th><Th>Archetype</Th><Th className="w-40">Fit</Th><Th>Coverage</Th><Th>Updated</Th>
                </tr></thead>
                <tbody>
                  {data.churches.map((c) => (
                    <tr key={c.church_id} className="group hover:bg-border/20">
                      <Td>
                        <Link href={`/churches/${c.church_id}`} className="font-medium text-fg group-hover:text-accent">{c.name ?? 'Unknown'}</Link>
                        {c.priority ? <Badge tone={priorityTone(c.priority)} className="ml-2">{c.priority}</Badge> : null}
                      </Td>
                      <Td className="text-muted">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</Td>
                      <Td className="tabular">{fmtNum(c.awa)}</Td>
                      <Td className="text-muted">{c.archetype ?? '—'}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <ScoreBar value={c.engagement_fit} className="w-24" />
                          <span className="w-7 text-right text-xs tabular">{c.engagement_fit ?? '—'}</span>
                        </div>
                      </Td>
                      <Td className="tabular text-muted">{fmtPct(c.coverage_percent)}</Td>
                      <Td className="text-xs text-muted">{timeAgo(c.last_researched_at)}</Td>
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
