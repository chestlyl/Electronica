"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Input, Button } from "@/components/ui";

const STATUSES = ["Verified Active", "Likely Active", "Uncertain", "Closed", "Merged"];

/** Search + filter bar. Pushes state into the URL; the server component re-queries. */
export function RepoFilters({ q, state, status }: { q: string; state: string; status: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ q, state, status });

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (form.q.trim()) p.set("q", form.q.trim());
    if (form.state.trim()) p.set("state", form.state.trim());
    if (form.status) p.set("status", form.status);
    router.push(`/repository${p.toString() ? `?${p}` : ""}`);
  }
  function reset() {
    setForm({ q: "", state: "", status: "" });
    router.push("/repository");
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Input placeholder="Search name…" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
      <Input placeholder="State (e.g. OH)" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
      <select
        value={form.status}
        onChange={(e) => setForm({ ...form, status: e.target.value })}
        className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent"
      >
        <option value="">Any status</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Button type="button" variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
    </form>
  );
}
