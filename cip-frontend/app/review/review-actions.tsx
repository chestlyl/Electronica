"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { setReviewStatus } from "./actions";

/** Approve / reject a review_queue item (status-only) with optional notes. */
export function ReviewActions({ id }: { id: string }) {
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function act(status: "approved" | "rejected") {
    setErr(null);
    start(async () => {
      const res = await setReviewStatus(id, status, notes);
      if (!res.ok) setErr(res.error ?? "Failed");
    });
  }

  return (
    <div className="space-y-2">
      <Input
        placeholder="Reviewer notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => act("approved")}>
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => act("rejected")}>
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
      </div>
      {err ? <div className="text-xs text-danger">{err}</div> : null}
    </div>
  );
}
