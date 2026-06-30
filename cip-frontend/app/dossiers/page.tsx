'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, Table, Th, Td, Input, Button, Spinner, Empty } from '@/components/ui';
import { fmtPct, timeAgo } from '@/lib/utils';

export default function DossiersPage() {
  const [q, setQ] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['churches', { q }], queryFn: () => api.churches({ q, limit: 200 }) });

  async function download(id: string, name: string | null) {
    setDownloading(id);
    try {
      const dossier = await api.dossier(id);
      const blob = new Blob([dossier.markdown ?? ''], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(name ?? 'dossier').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setDownloading(null); }
  }

  return (
    <>
      <PageHeader title="Dossiers" subtitle="Completed research dossiers" />
      <div className="space-y-4 p-6">
        <Input placeholder="Search dossiers…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Card>
          {isLoading ? <Spinner /> : !data?.churches.length ? <Empty>No dossiers yet.</Empty> : (
            <Table>
              <thead><tr><Th>Church</Th><Th>Location</Th><Th>Coverage</Th><Th>Updated</Th><Th></Th></tr></thead>
              <tbody>
                {data.churches.map((c) => (
                  <tr key={c.church_id} className="hover:bg-border/20">
                    <Td className="font-medium">{c.name ?? 'Unknown'}</Td>
                    <Td className="text-muted">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</Td>
                    <Td className="tabular text-muted">{fmtPct(c.coverage_percent)}</Td>
                    <Td className="text-xs text-muted">{timeAgo(c.last_researched_at)}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Link href={`/churches/${c.church_id}`}><Button size="sm" variant="ghost">Open</Button></Link>
                        <Button size="sm" onClick={() => download(c.church_id, c.name)} disabled={downloading === c.church_id}>{downloading === c.church_id ? '…' : 'Download .md'}</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <p className="text-xs text-muted">PDF / DOCX export coming next — Markdown is exported from the live dossier today.</p>
      </div>
    </>
  );
}
