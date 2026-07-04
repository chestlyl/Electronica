"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { setOutreachApproval } from "./actions";

/** Approve / reject an outreach lead (status-only). */
export function OutreachActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const decided = status === "approved" || status === "rejected" || status === "sent";

  function act(next: "approved" | "rejected") {
    setErr(null);
    start(async () => {
      const res = await setOutreachApproval(id, next);
      if (!res.ok) setErr(res.error ?? "Failed");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="primary" disabled={pending || status === "approved"} onClick={() => act("approved")}>
        <Check className="h-3.5 w-3.5" /> Approve
      </Button>
      <Button size="sm" variant="danger" disabled={pending || status === "rejected"} onClick={() => act("rejected")}>
        <X className="h-3.5 w-3.5" /> Reject
      </Button>
      {decided ? <span className="text-xs text-muted">marked {status}</span> : null}
      {err ? <span className="text-xs text-danger">{err}</span> : null}
    </div>
  );
}
