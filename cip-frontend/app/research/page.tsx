'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/app-shell';
import { Card, CardHeader, Button, Input, Label, Badge } from '@/components/ui';
import { Search, MapPin } from 'lucide-react';

export default function ResearchPage() {
  const router = useRouter();

  // ── Known church ────────────────────────────────────────────────────────────
  const [kc, setKc] = useState({ name: '', url: '', city: '', state: '' });
  const known = useMutation({
    mutationFn: () => api.startKnownChurch({ name: kc.name, url: kc.url || undefined, city: kc.city || undefined, state: kc.state || undefined }),
    onSuccess: () => router.push('/queue'),
  });

  // ── Market research ─────────────────────────────────────────────────────────
  const [mr, setMr] = useState({ metro: '', city: '', state: '', min_awa: '', max_awa: '', denomination: '', unknown_only: true });
  const market = useMutation({
    mutationFn: () => api.startDiscovery({
      metro: mr.metro || mr.city, state: mr.state || undefined, limit: 25,
      filters: { unknown_only: mr.unknown_only, min_awa: mr.min_awa ? Number(mr.min_awa) : null, denomination: mr.denomination || undefined },
    }),
    onSuccess: () => router.push('/queue'),
  });

  return (
    <>
      <PageHeader title="Research" subtitle="Run a known-church dossier, or discover churches in a market" />
      <div className="grid grid-cols-1 gap-5 p-6 xl:grid-cols-2">
        {/* Known Church */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Search className="h-4 w-4 text-accent" /> Known Church Research</span>} subtitle="You know the church — get a complete intelligence dossier" />
          <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); known.mutate(); }}>
            <div><Label>Church Name *</Label><Input required placeholder="Cross Point Church" value={kc.name} onChange={(e) => setKc({ ...kc, name: e.target.value })} /></div>
            <div><Label>Website URL (optional)</Label><Input placeholder="https://crosspoint.tv" value={kc.url} onChange={(e) => setKc({ ...kc, url: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>City</Label><Input placeholder="Nashville" value={kc.city} onChange={(e) => setKc({ ...kc, city: e.target.value })} /></div>
              <div><Label>State</Label><Input placeholder="TN" value={kc.state} onChange={(e) => setKc({ ...kc, state: e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button type="submit" variant="primary" disabled={!kc.name || known.isPending}>{known.isPending ? 'Starting…' : 'Research Church'}</Button>
              {known.isError ? <span className="text-xs text-danger">{(known.error as Error).message}</span> : null}
            </div>
          </form>
        </Card>

        {/* Market Research */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-accent" /> Market Research</span>} subtitle="Discover churches in a region and find the best opportunities" />
          <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); market.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Metro Area</Label><Input placeholder="Nashville" value={mr.metro} onChange={(e) => setMr({ ...mr, metro: e.target.value })} /></div>
              <div><Label>State</Label><Input placeholder="TN" value={mr.state} onChange={(e) => setMr({ ...mr, state: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Min Attendance</Label><Input type="number" placeholder="500" value={mr.min_awa} onChange={(e) => setMr({ ...mr, min_awa: e.target.value })} /></div>
              <div><Label>Max Attendance</Label><Input type="number" placeholder="—" value={mr.max_awa} onChange={(e) => setMr({ ...mr, max_awa: e.target.value })} /></div>
            </div>
            <div><Label>Denomination (optional)</Label><Input placeholder="Any" value={mr.denomination} onChange={(e) => setMr({ ...mr, denomination: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={mr.unknown_only} onChange={(e) => setMr({ ...mr, unknown_only: e.target.checked })} className="accent-[rgb(var(--accent))]" />
              Unknown churches only (not already in the repository)
            </label>
            <div className="flex items-center justify-between pt-1">
              <Button type="submit" variant="primary" disabled={!(mr.metro || mr.city) || market.isPending}>{market.isPending ? 'Starting…' : 'Find Churches'}</Button>
              <Badge tone="muted">runs in the queue</Badge>
            </div>
            {market.isError ? <span className="text-xs text-danger">{(market.error as Error).message}</span> : null}
          </form>
        </Card>
      </div>
    </>
  );
}
