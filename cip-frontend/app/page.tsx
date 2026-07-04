import Link from "next/link";
import { Building2, Sparkles, ListChecks, Send, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { getDashboardStats, supabaseConfigured, OUTREACH_FIT_THRESHOLD } from "@/lib/db";
import { fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CARDS = [
  { key: "total", label: "Total churches", href: "/repository", icon: Building2, hint: "in the repository" },
  { key: "enriched", label: "Enriched churches", href: "/repository", icon: Sparkles, hint: "processed by enrichment" },
  { key: "reviewPending", label: "Review queue", href: "/review", icon: ListChecks, hint: "low-confidence, awaiting review" },
  { key: "outreachReady", label: "Outreach-ready leads", href: "/outreach", icon: Send, hint: `verified email · fit ≥ ${OUTREACH_FIT_THRESHOLD}` },
] as const;

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Church Intelligence Platform overview" />
      <div className="space-y-6 p-6">
        {!supabaseConfigured && <ConfigBanner />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.key} href={c.href}>
                <Card className="p-4 transition-colors hover:border-accent/40">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">{c.label}</span>
                    <Icon className="h-4 w-4 text-muted" />
                  </div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight">{fmtNum(stats[c.key])}</div>
                  <div className="mt-1 text-xs text-muted">{c.hint}</div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ConfigBanner() {
  return (
    <Card className="flex items-start gap-3 border-warn/30 bg-warn/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      <div className="text-sm">
        <div className="font-medium text-fg">Supabase not configured</div>
        <p className="mt-1 text-muted">
          Set <code className="rounded bg-border/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-border/50 px-1">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
          <code className="rounded bg-border/50 px-1">cip-frontend/.env.local</code>, apply the migrations, then restart{" "}
          <code className="rounded bg-border/50 px-1">npm run dev</code>. All counts read live from the{" "}
          <code className="rounded bg-border/50 px-1">churches</code> table.
        </p>
      </div>
    </Card>
  );
}
