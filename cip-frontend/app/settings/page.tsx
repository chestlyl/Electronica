'use client';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Card, CardHeader, Badge, Button } from '@/components/ui';

function ServiceRow({ name, note, status }: { name: string; note: string; status: 'ok' | 'unknown' | 'down' }) {
  const tone = status === 'ok' ? 'success' : status === 'down' ? 'danger' : 'muted';
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 last:border-0">
      <div><div className="text-sm font-medium">{name}</div><div className="text-xs text-muted">{note}</div></div>
      <Badge tone={tone as 'success' | 'danger' | 'muted'}>{status === 'ok' ? 'connected' : status === 'down' ? 'unreachable' : 'unknown'}</Badge>
    </div>
  );
}

export default function SettingsPage() {
  const [apiUp, setApiUp] = useState<'ok' | 'unknown' | 'down'>('unknown');
  const [dark, setDark] = useState(true);

  useEffect(() => {
    fetch('/api/cip/health').then((r) => setApiUp(r.ok ? 'ok' : 'down')).catch(() => setApiUp('down'));
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
  }, [dark]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Platform configuration and preferences" />
      <div className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="API Configuration" subtitle="Backend services the platform depends on" />
          <ServiceRow name="Church Intelligence API" note="The CIP backend this UI proxies to" status={apiUp} />
          <ServiceRow name="Supabase" note="System of record (cip_* tables)" status="unknown" />
          <ServiceRow name="Claude (Anthropic)" note="Extraction + synthesis (worker)" status="unknown" />
          <ServiceRow name="Google Places" note="Market discovery (worker)" status="unknown" />
          <ServiceRow name="Serper / Brave" note="Search backend for secondary evidence (worker)" status="unknown" />
          <p className="px-4 py-3 text-xs text-muted">Worker-side keys (Claude/Places/Serper) live in the agent&apos;s environment, not the UI. Only the CIP API status is checked live here.</p>
        </Card>

        <Card>
          <CardHeader title="User Preferences" />
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div><div className="text-sm">Theme</div><div className="text-xs text-muted">Executive dark (default) or light</div></div>
              <Button size="sm" onClick={() => setDark((v) => !v)}>{dark ? 'Dark' : 'Light'}</Button>
            </div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm">Default research limit</div><div className="text-xs text-muted">Max churches per market run</div></div>
              <Badge tone="muted">25</Badge>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Organization" subtitle="Team, permissions, billing" />
          <p className="px-4 py-6 text-sm text-muted">Team management and billing arrive with Supabase Auth in the next pass.</p>
        </Card>
      </div>
    </>
  );
}
