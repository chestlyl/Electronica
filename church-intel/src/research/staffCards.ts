/**
 * Staff-card extraction heuristic (Playwright-free so it is unit-testable).
 *
 * Staff/leadership pages render repeated blocks of: a name-like line, a
 * role/title-like line, and optional bio/contact. From rendered innerText (or
 * raw visible text) this recovers {name, title} pairs, handling both same-line
 * ("Jacob Young — Lead Pastor") and adjacent-line ("Jacob Young\nLead Pastor")
 * layouts. Names are only paired when followed by a role-like title, so generic
 * capitalized lines are not mistaken for staff.
 */
export interface StaffCard {
  name: string;
  title: string;
}

// Words that indicate a church role/title (used to recognize the title line and
// to reject role lines from being treated as names).
const ROLE_WORDS =
  /\b(pastors?|director|operations?|ops|communications?|comms|creative|media|ministr(?:y|ies)|engagement|marketing|digital|next\s+steps|next\s+gen|teaching|community|weekends?|worship|administrator|admin|coordinator|connections?|discipleship|kids|children|youth|students?|missions?|ambassador|elder|deacon|leader|lead|associate|executive|exec|family|families|groups|care|generosity|production|hospitality|guest|first\s+impressions|campus|connect|outreach|assistant)\b/i;

const NAME_RE = /^(?:Pastor|Ps|Dr\.?|Rev\.?|Mr\.?|Mrs\.?|Ms\.?)?\s*[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}$/;

const HONORIFIC = /^(?:Pastor|Ps|Dr\.?|Rev\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i;
function cleanName(raw: string): string {
  return raw.replace(HONORIFIC, '').replace(/\s+/g, ' ').trim();
}
function looksLikeName(s: string): boolean {
  if (s.length < 4 || s.length > 45) return false;
  // Test the core (without an honorific like "Pastor") so "Pastor Brenda Young"
  // is recognized as a name, while a pure role line ("Lead Pastor") is not.
  if (ROLE_WORDS.test(s.replace(HONORIFIC, ''))) return false;
  return NAME_RE.test(s);
}
function looksLikeTitle(s: string): boolean {
  if (!s || s.length > 70) return false;
  if (/[.!?]$/.test(s) && s.length > 40) return false; // a bio sentence, not a title
  return ROLE_WORDS.test(s);
}

/** Recover {name, title} staff cards from rendered innerText (or raw text). */
export function extractStaffCards(text: string): StaffCard[] {
  const cards: StaffCard[] = [];
  const seen = new Set<string>();
  const push = (rawName: string, rawTitle: string) => {
    const name = cleanName(rawName);
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (!name || !title || seen.has(key)) return;
    seen.add(key);
    cards.push({ name, title });
  };

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // same-line "Name <sep> Title"
    const m = line.match(/^((?:Pastor|Ps|Dr\.?|Rev\.?)?\s*[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3})\s*[—–\-|,:•]\s*(.+)$/);
    if (m && !ROLE_WORDS.test(m[1].replace(HONORIFIC, '')) && looksLikeTitle(m[2])) { push(m[1], m[2]); continue; }
    // adjacent lines: a name followed by a role-like title
    if (looksLikeName(line) && i + 1 < lines.length && looksLikeTitle(lines[i + 1]) && !looksLikeName(lines[i + 1])) {
      push(line, lines[i + 1]);
      i++;
    }
  }
  return cards;
}

/** Map a staff-card title to a canonical relationship role (or null). */
export function roleFromTitle(title: string): { field: string; confidence: number } | null {
  const t = title.toLowerCase();
  if (/\b(lead|senior)\s+pastor\b/.test(t)) return { field: 'lead_pastor', confidence: 80 };
  if (/\bexec(?:utive)?\s+pastor\b/.test(t)) return { field: 'executive_pastor', confidence: 80 };
  if (/\boperations?\b|\bops\b/.test(t)) return { field: 'operations_leader', confidence: 78 };
  if (/\b(communications?|comms|creative|media|engagement|marketing|digital)\b/.test(t)) return { field: 'communications_leader', confidence: 75 };
  return null;
}

/** Count how many cards map to a known relationship role. */
export function rolesDetected(cards: StaffCard[]): number {
  return cards.filter((c) => roleFromTitle(c.title) != null).length;
}
