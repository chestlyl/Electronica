/**
 * Nightly orchestrator — sequences the unattended overnight run so a fresh
 * review queue and a drafted "Today's 300" are ready in the morning. Steps are
 * INJECTED (each an async function returning a StepResult), so the sequencing,
 * error isolation, and dry-run behavior are unit-testable offline without any
 * network or Supabase.
 *
 * Design: overnight the job PREPARES (discover → generate batch → optional CRM
 * sync); a human APPROVES in the UI in the morning. Nothing is sent.
 *
 * Error isolation: a failing step is recorded and the run CONTINUES — one broken
 * step must not sink the rest of the night's work.
 */

export interface StepResult {
  status: "ok" | "skipped" | "failed";
  detail: string;
  metrics?: Record<string, number>;
}

export interface NightlyStep {
  name: string;
  run: (ctx: { dryRun: boolean }) => Promise<StepResult>;
}

export interface NightlySummary {
  startedAt: string;
  dryRun: boolean;
  steps: { name: string; result: StepResult }[];
  ok: boolean;
}

export async function runNightly(
  steps: NightlyStep[],
  opts: { startedAt: string; dryRun?: boolean; log?: (msg: string) => void },
): Promise<NightlySummary> {
  const log = opts.log ?? (() => {});
  const dryRun = !!opts.dryRun;
  const results: { name: string; result: StepResult }[] = [];

  log(`Nightly run @ ${opts.startedAt}${dryRun ? " (dry-run)" : ""}`);
  for (const step of steps) {
    log(`▶ ${step.name}`);
    try {
      const result = await step.run({ dryRun });
      results.push({ name: step.name, result });
      log(`  ${result.status}: ${result.detail}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      results.push({ name: step.name, result: { status: "failed", detail } });
      log(`  failed: ${detail}`);
    }
  }

  const ok = results.every((r) => r.result.status !== "failed");
  log(`Nightly ${ok ? "complete" : "completed WITH FAILURES"} — ${results.filter((r) => r.result.status === "ok").length}/${results.length} ok`);
  return { startedAt: opts.startedAt, dryRun, steps: results, ok };
}

/** Render a compact summary for logs / notifications. */
export function renderNightlySummary(s: NightlySummary): string {
  const lines = [`Nightly run — ${s.startedAt}${s.dryRun ? " (dry-run)" : ""} — ${s.ok ? "OK" : "FAILURES"}`];
  for (const { name, result } of s.steps) {
    const mark = result.status === "ok" ? "✓" : result.status === "skipped" ? "–" : "✗";
    lines.push(`  ${mark} ${name}: ${result.detail}`);
  }
  return lines.join("\n");
}
