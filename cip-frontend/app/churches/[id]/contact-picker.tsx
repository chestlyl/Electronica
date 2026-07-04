"use client";

import { useState, useTransition } from "react";
import { Check, Mail } from "lucide-react";
import { Badge } from "@/components/ui";
import { fmtPct } from "@/lib/utils";
import { setOutreachEmail } from "./actions";
import type { ChurchContactRow } from "@/lib/db";

const catTone = (c: string) =>
  c === "person" ? "success" : c === "role" ? "accent" : c === "church" ? "default" : "muted";

/** Lists every discovered email; the radio picks the one used for outreach. */
export function ContactPicker({ churchId, contacts }: { churchId: string; contacts: ChurchContactRow[] }) {
  const [selected, setSelected] = useState(contacts.find((c) => c.selected_for_outreach)?.id ?? null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function choose(id: string) {
    const prev = selected;
    setSelected(id);
    setErr(null);
    start(async () => {
      const res = await setOutreachEmail(churchId, id);
      if (!res.ok) { setSelected(prev); setErr(res.error ?? "Failed"); }
    });
  }

  if (!contacts.length) return <div className="text-sm text-muted">No emails discovered yet.</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Mail className="h-3.5 w-3.5" /> {contacts.length} email(s) found — select which to use for outreach
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border">
        {contacts.map((c) => {
          const active = selected === c.id;
          return (
            <button
              key={c.id}
              onClick={() => choose(c.id)}
              disabled={pending}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                active ? "bg-accent/10" : "hover:bg-border/30"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-accent bg-accent text-bg" : "border-border"
                  }`}
                >
                  {active ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="truncate font-medium">{c.email}</span>
                {c.name ? <span className="truncate text-xs text-muted">{c.name}</span> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={catTone(c.category)}>{c.category}</Badge>
                <span className="w-10 text-right text-xs tabular text-muted">{fmtPct(c.confidence)}</span>
              </div>
            </button>
          );
        })}
      </div>
      {err ? <div className="text-xs text-danger">{err}</div> : null}
    </div>
  );
}
