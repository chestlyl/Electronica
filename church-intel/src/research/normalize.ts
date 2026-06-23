import type { SourceFinding } from './dossier.js';
import type { Facts, LeaderCandidate } from './extractors.js';
import type { PlatformHit } from './techStack.js';
import type { StrategicSignal } from './strategicSignals.js';
import type { ResearchConflict, EvidenceAccessLevel } from '../types.js';
import {
  emptyNormalizedEvidence,
  type NormalizedEvidence,
  type NormalizedRow,
  type RawEvidence,
} from './evidenceModel.js';

/**
 * Layer 3 — Evidence Normalization.
 *
 * Turns the collectors' raw findings (+ the deterministic extractor outputs that
 * already exist) into structured evidence TABLES. It makes NO conclusions:
 * `leaders` lists every leader candidate (not "the lead pastor"); `external_signals`
 * lists every signal (not a digital-maturity score). The interpreter decides.
 */

// ── Layer 2 adapter: SourceFinding[] → RawEvidence[] ─────────────────────────
export function toRawEvidence(findings: SourceFinding[]): RawEvidence[] {
  return findings.map((f, i) => ({
    id: `raw_${i + 1}`,
    source_type: f.sourceType,
    source_url: f.url,
    page_category: f.category ?? 'unknown',
    text_excerpt: ((f.fetched ? f.text : f.snippet) ?? '').slice(0, 2000),
    outbound_links: f.outboundLinks ?? [],
    fetched: f.fetched,
    rendered: f.crawlMethod === 'playwright_rendered',
    crawl_method: f.crawlMethod ?? (f.fetched ? 'fetch' : 'none'),
    access_level: f.accessLevel,
    collected_at: f.fetchedAt,
  }));
}

// conservative US street-address pattern (street line + city, ST ZIP)
const ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9.\- ]{2,40},?\s+[A-Za-z .'-]{2,30},\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;
// a clock time like "9:00am" / "10 AM" / "11:30 a.m."
const TIME_RE = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/gi;
const SERVICE_CTX = /\b(service|services|worship|gathering|sunday|saturday|weekend|mass)\b/i;

/** Conservative service-time detection: clock times that appear in a
 *  service/worship/Sunday context (so we don't grab unrelated times). Deduped. */
export function extractServiceTimes(findings: SourceFinding[]): { time: string; source_url: string }[] {
  const out: { time: string; source_url: string }[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (!['home', 'about', 'contact', 'visit', 'service', 'services'].includes(f.category ?? '') && f.category != null) continue;
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`;
    // scan windows around service keywords
    for (const m of text.matchAll(/[^.]*\b(?:service|services|worship|gathering|sunday|saturday|weekend|mass)\b[^.]*/gi)) {
      const window = m[0];
      for (const t of window.matchAll(TIME_RE)) {
        const norm = t[1].replace(/\s+/g, '').replace(/\./g, '').toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        out.push({ time: t[1].replace(/\s+/g, ' ').trim(), source_url: f.url });
        if (out.length >= 12) return out;
      }
    }
    if (!SERVICE_CTX.test(text)) continue;
  }
  return out;
}

export interface NormalizeInput {
  findings: SourceFinding[];
  facts: Facts;
  leadership: LeaderCandidate[];
  techStack: PlatformHit[];
  strategicSignals: StrategicSignal[];
  conflicts: ResearchConflict[];
}

export function normalizeEvidence(input: NormalizeInput): NormalizedEvidence {
  const ev = emptyNormalizedEvidence();
  const { findings, facts, leadership, techStack, strategicSignals, conflicts } = input;

  // leaders[] — every leader candidate, with provenance (NOT a single conclusion).
  leadership.forEach((l, i) => {
    ev.leaders.push({
      // category encodes the (co-)lead flag so the interpreter can pick leads
      // without re-reading raw evidence: isLead → "lead_pastor".
      id: `leader_${i + 1}`, value: l.name, category: l.isLead ? 'lead_pastor' : l.role, detail: l.title,
      source_url: l.sourceUrl, evidence_text: l.evidence, confidence: l.confidence,
      access_level: accessOfUrl(findings, l.sourceUrl), extractor_name: 'aggregateLeadership',
    });
  });

  // staff_roster[] — raw {name,title} cards as collected (superset of leaders).
  let rosterN = 0;
  for (const f of findings) {
    for (const card of f.staffCards ?? []) {
      ev.staff_roster.push({
        id: `roster_${++rosterN}`, value: card.name, category: 'staff', detail: card.title,
        source_url: f.url, evidence_text: `${card.name} — ${card.title}`, confidence: Math.round((f.reliability ?? 0.5) * 80),
        access_level: f.accessLevel, extractor_name: 'staffCards',
      });
    }
  }

  // Merge the deterministic ROLE facts (extractFacts) INTO leaders so leadership
  // has a SINGLE normalized source. A role fact naming a person not already in
  // the leaders table is added (so facts can never disagree with the leaders the
  // interpreter reads — facts becomes an input, not a competing conclusion).
  const ROLE_FACT_CATEGORY: Record<string, string> = {
    lead_pastor: 'lead_pastor', executive_pastor: 'executive_pastor',
    operations_leader: 'operations_leader', communications_leader: 'communications_leader',
  };
  const haveLeader = (name: string) => ev.leaders.some((l) => l.value.toLowerCase() === name.toLowerCase());
  let factLeaderN = 0;
  for (const [factKey, category] of Object.entries(ROLE_FACT_CATEGORY)) {
    const fact = facts[factKey];
    const name = fact?.value == null ? '' : String(fact.value).trim();
    if (!name || haveLeader(name)) continue;
    ev.leaders.push({
      id: `leader_fact_${++factLeaderN}`, value: name, category, detail: factKey.replace(/_/g, ' '),
      source_url: fact!.source_url, evidence_text: fact!.evidence, confidence: fact!.confidence,
      access_level: fact!.access_level, extractor_name: 'extractFacts',
    });
  }

  // contacts[] — office email / phone (from the deterministic facts).
  const contactFact = (key: string, category: string): void => {
    const fact = facts[key];
    if (!fact || fact.value == null || fact.value === '') return;
    ev.contacts.push({
      id: `contact_${category}`, value: String(fact.value), category, source_url: fact.source_url,
      evidence_text: fact.evidence, confidence: fact.confidence, access_level: fact.access_level, extractor_name: 'extractFacts',
    });
  };
  contactFact('office_email', 'email');
  contactFact('office_phone', 'phone');

  // locations[] — conservative address extraction from contact/home/about pages.
  let locN = 0;
  for (const f of findings) {
    if (!['home', 'contact', 'about'].includes(f.category ?? '')) continue;
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`;
    const m = text.match(ADDRESS_RE);
    if (m) ev.locations.push({
      id: `location_${++locN}`, value: m[0].replace(/\s+/g, ' ').trim(), category: 'address',
      source_url: f.url, evidence_text: m[0].slice(0, 160), confidence: 65, access_level: f.accessLevel, extractor_name: 'addressRegex',
    });
  }

  // services[] — service/gathering times (a weak attendance-size signal).
  extractServiceTimes(findings).forEach((s, i) => ev.services.push({
    id: `service_${i + 1}`, value: s.time, category: 'service_time', source_url: s.source_url,
    evidence_text: `service time ${s.time}`, confidence: 60, access_level: accessOfUrl(findings, s.source_url), extractor_name: 'extractServiceTimes',
  }));

  // technology_stack[] — deterministic platform hits.
  techStack.forEach((t, i) => ev.technology_stack.push({
    id: `tech_${i + 1}`, value: t.platform_name, category: t.category, source_url: t.evidence_url,
    evidence_text: `${t.platform_name} (${t.category})`, confidence: t.confidence,
    access_level: accessOfUrl(findings, t.evidence_url), extractor_name: 'detectTechStack',
  }));

  // external_signals[] — every strategic signal; sub-tables are filtered views.
  strategicSignals.forEach((s, i) => {
    const row: NormalizedRow = {
      id: `signal_${i + 1}`, value: s.category, category: s.category,
      detail: `${s.anchor_text ? `"${s.anchor_text}" → ` : ''}${s.host} [${s.dimensions.join(',')}]`,
      source_url: s.destination_url, evidence_text: `${s.source_page} → ${s.destination_url}`,
      confidence: s.confidence, access_level: s.access_level, extractor_name: 'detectStrategicSignals',
    };
    ev.external_signals.push(row);
    if (s.category === 'jobs_hiring') ev.jobs_hiring.push(row);
    if (s.category === 'network_affiliation') ev.network_affiliations.push(row);
    if (s.category === 'livestream_video' || s.category === 'podcast') ev.sermons_media.push(row);
    if (s.category === 'groups' || s.category === 'school_academy') ev.ministries.push(row);
  });

  // conflicts[] — preserved disagreements (never silently resolved).
  conflicts.forEach((c, i) => ev.conflicts.push({
    id: `conflict_${i + 1}`, value: c.recommended_value ?? '', category: c.field_name,
    detail: `"${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b})`,
    source_url: '', evidence_text: c.conflict_summary ?? '', confidence: c.confidence ?? 0,
    access_level: 'search_snippets', extractor_name: 'detectConflicts',
  }));

  return ev;
}

/** Best-effort access level for an evidence URL (matches a finding by URL/host). */
function accessOfUrl(findings: SourceFinding[], url: string): EvidenceAccessLevel {
  const exact = findings.find((f) => f.url === url);
  if (exact) return exact.accessLevel;
  let host = ''; try { host = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname; } catch { /* keep '' */ }
  const byHost = host ? findings.find((f) => { try { return new URL(f.url).hostname === host; } catch { return false; } }) : undefined;
  return byHost?.accessLevel ?? 'search_snippets';
}
