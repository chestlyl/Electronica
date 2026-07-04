import { buildContactIntel, type ContactIntelligence, type ContactChannel } from "./contactIntel.js";
import type { DossierBuild } from "./researchAgent.js";

/**
 * Flatten the Contact Intelligence layer into persistable church_contacts rows —
 * EVERY discovered email, bucketed by category, deduped (highest confidence
 * wins). This is what powers "show me all staff emails and let me pick one".
 */

export interface ChurchContactRow {
  email: string;
  name: string | null;
  role: string | null;
  category: "church" | "role" | "person" | "unassigned";
  source_url: string | null;
  confidence: number | null;
}

function pushChannels(
  out: Map<string, ChurchContactRow>,
  channels: ContactChannel[],
  category: ChurchContactRow["category"],
): void {
  for (const c of channels) {
    const email = c.value.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const row: ChurchContactRow = {
      email,
      name: c.label ?? null,
      role: category === "role" ? c.label ?? null : null,
      category,
      source_url: c.source_url ?? null,
      confidence: c.confidence ?? null,
    };
    const existing = out.get(email);
    // Keep the highest-confidence instance; because channels are pushed
    // least→most specific, `>=` lets a more specific category (person > role >
    // church > unassigned) win on equal confidence — but never on lower.
    if (!existing || (row.confidence ?? 0) >= (existing.confidence ?? 0)) out.set(email, row);
  }
}

/** Flatten a ContactIntelligence object → deduped contact rows. Pure + testable. */
export function flattenContactChannels(ci: ContactIntelligence): ChurchContactRow[] {
  const out = new Map<string, ChurchContactRow>();
  // Order matters for the dedup tie-break: least→most specific, so specific wins.
  pushChannels(out, ci.unassigned_emails, "unassigned");
  pushChannels(out, ci.church_emails, "church");
  pushChannels(out, ci.role_emails, "role");
  pushChannels(out, ci.person_emails, "person");
  return [...out.values()];
}

/** Build deduped contact rows from a dossier build (runs the Contact Intelligence layer). */
export function contactRowsFromBuild(build: DossierBuild): ChurchContactRow[] {
  const ci = buildContactIntel({
    findings: build.contactFindings ?? build.findings,
    normalized: build.normalized,
    interpretation: build.interpretation,
    contaminatedHosts: build.contaminationSources?.hosts,
  });
  return flattenContactChannels(ci);
}
