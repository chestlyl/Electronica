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
export function stripHonorific(raw: string): string {
  return raw.replace(HONORIFIC, '').replace(/\s+/g, ' ').trim();
}
function cleanName(raw: string): string {
  return stripHonorific(raw);
}

// Section headings ("Our Staff", "Meet Our Team", "Our Pastors") are NOT people.
const HEADING_RE = /^(?:our|the|meet(?:\s+(?:our|the))?)\s+[\w\s'’]{0,24}?\b(staff|teams?|pastors?|leaders?|leadership|people|elders?|deacons?|board|family|crew|ministr(?:y|ies))\b|^(?:staff|teams?|leadership|leaders|our staff|our team|our pastors|our leadership|meet the team)$/i;
function isHeading(s: string): boolean {
  return HEADING_RE.test(s.trim());
}

// Paired name "Pastor Dan & Jennifer Zirkle" / "Dan and Jennifer Zirkle" with a
// SHARED surname → two people. Honorifics on either given name are allowed.
const HON_SRC = '(?:Pastors?|Drs?\\.?|Revs?\\.?|Ps\\.?|Mr\\.?|Mrs\\.?|Ms\\.?)\\s+';
const PAIRED_NAME_RE = new RegExp(`^(?:${HON_SRC})?([A-Z][a-zA-Z'’.-]+)\\s*(?:&|\\+|and|And)\\s*(?:${HON_SRC})?([A-Z][a-zA-Z'’.-]+)\\s+([A-Z][a-zA-Z'’.-]+)$`);
export function parsePairedName(line: string): string[] | null {
  const m = line.trim().match(PAIRED_NAME_RE);
  if (!m) return null;
  const [, g1, g2, surname] = m;
  return [`${g1} ${surname}`, `${g2} ${surname}`];
}
// Split a paired title "Lead Pastor & Worship Director" into ordered titles.
function splitTitles(line: string): string[] {
  return line.split(/\s*(?:&|\+|\/|\band\b)\s*/i).map((t) => t.trim()).filter(Boolean);
}
/**
 * Expand a paired-name line (+ optional paired-title line) into one card per
 * person, zipping titles positionally (first title → first name, etc.). Returns
 * null when the line is not a paired name or no usable title is available.
 */
export function expandPaired(nameLine: string, titleLine: string | undefined): StaffCard[] | null {
  const names = parsePairedName(nameLine);
  if (!names) return null;
  const titles = titleLine && looksLikeTitle(titleLine) ? splitTitles(titleLine) : [];
  if (!titles.length) return null;
  const cards = names.map((name, i) => ({ name, title: titles[i] ?? titles[titles.length - 1] })).filter((c) => c.title);
  return cards.length ? cards : null;
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
// Tokens that mark a "name" as a nav button / ministry label, not a person
// (e.g. "BUILDING CAMPAIGN UPDATE", "PARENT EMAILS", "LIFE NEEDS", "Read More").
// Includes common navigation/CTA words ("Plan", "Watch", "Give", "Connect"…) so a
// Title-Case nav string that passes NAME_RE is still rejected.
const NON_PERSON_NAME = /\b(update|updates|emails?|campaign|building|needs|resources?|ministr(?:y|ies)|giving|give|newsletter|calendar|events?|prayer|missions?|outreach|baptisms?|blessings?|volunteer|serve|donate|welcome|menu|search|cart|login|logout|register|subscribe|account|profile|read\s+more|learn\s+more|see\s+more|view\s+all|next\s+steps|plan|visit|watch|online|livestream|connect|involved|story|believe|beliefs|location|locations|campus|campuses|schedule|directions|parent|sermons?|podcasts?|app|blog|faq)\b/i;
// Organizational / collective labels are NOT people ("Lead Team", "Elder Board",
// "Worship Team", "Leadership Council", "Our Elders"). These can pass NAME_RE as
// two Title-Case words, so reject any candidate carrying a collective-noun token.
const ORG_LABEL = /\b(teams?|board|council|committee|cohort|department|congregation|elders?|deacons?|trustees?|staff|leadership|directory)\b/i;
// Full-string navigation / call-to-action phrases (anchored, so real names are
// never matched). Catches Title-Case CTAs that slip past the token lists above.
const NAV_CTA = /^(?:plan (?:a |your )?visit|watch(?: online| live| now| party)?|give(?: now| online)?|giving|new here|i'?m new|get involved|next steps|our (?:story|team|staff|leaders|leadership|church|mission)|meet (?:the|our) (?:team|staff|leaders|pastors)|connect(?: with us)?|contact(?: us)?|join us|learn more|read more|see (?:all|more)|view all|sign in|log ?in|sign up|donate(?: now)?|listen(?: now)?|subscribe|search|menu|home|locations?|campuses?|directions|map|espa(?:ñ|n)ol|en espa(?:ñ|n)ol|prayer(?: request)?|live ?stream)$/i;
export function isPersonName(name: string): boolean {
  const n = name.trim();
  if (/[0-9@]/.test(n) || /\b(a\.?m\.?|p\.?m\.?)\b/i.test(n)) return false;
  if (NON_PERSON_NAME.test(n)) return false;
  if (ORG_LABEL.test(n)) return false;
  if (NAV_CTA.test(n)) return false;
  return true;
}

export function extractStaffCards(text: string): StaffCard[] {
  const cards: StaffCard[] = [];
  const seen = new Set<string>();
  const push = (rawName: string, rawTitle: string) => {
    const name = cleanName(rawName);
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (!name || !title || seen.has(key) || !isPersonName(name)) return;
    seen.add(key);
    cards.push({ name, title });
  };

  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeading(line)) continue; // never let a section heading become a card
    // PAIRED name "Pastor Dan & Jennifer Zirkle" + next-line paired title.
    const pairedAdjacent = expandPaired(line, lines[i + 1]);
    if (pairedAdjacent) { for (const c of pairedAdjacent) push(c.name, c.title); i++; continue; }
    // PAIRED name + title on ONE line ("A & B Surname — T1 & T2").
    const sameLine = line.match(/^(.+?)\s*[—–|:•]\s*(.+)$/);
    if (sameLine) {
      const pairedSame = expandPaired(sameLine[1], sameLine[2]);
      if (pairedSame) { for (const c of pairedSame) push(c.name, c.title); continue; }
    }
    // same-line "Name <sep> Title"
    const m = line.match(/^((?:Pastor|Ps|Dr\.?|Rev\.?)?\s*[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3})\s*[—–\-|,:•]\s*(.+)$/);
    if (m && !ROLE_WORDS.test(m[1].replace(HONORIFIC, '')) && looksLikeTitle(m[2])) { push(m[1], m[2]); continue; }
    // adjacent lines: a name followed by a role-like title
    if (looksLikeName(line) && !isHeading(line) && i + 1 < lines.length && looksLikeTitle(lines[i + 1]) && !looksLikeName(lines[i + 1])) {
      push(line, lines[i + 1]);
      i++;
    }
  }
  return cards;
}

/** Map a staff-card title to a canonical relationship role (or null). */
export function roleFromTitle(title: string): { field: string; confidence: number } | null {
  const t = title.toLowerCase();
  // Lead pastor — lead/senior/founding, and the co-lead/co-senior variants.
  if (/\b(?:lead|senior|founding)\s+pastors?\b/.test(t) || /\bco[-\s]?(?:lead|senior)\s+pastors?\b/.test(t)) return { field: 'lead_pastor', confidence: 80 };
  if (/\bexec(?:utive)?\s+(pastor|director)\b/.test(t)) return { field: 'executive_pastor', confidence: 80 };
  // Campus pastor — specific; classify before the generic ministry roles below.
  if (/\bcampus\s+pastor\b/.test(t)) return { field: 'campus_pastor', confidence: 76 };
  // Discipleship / Next Steps owner (per calibration this should own the lift before comms).
  if (/\b(discipleship|next\s*steps|spiritual\s+formation)\b/.test(t)) return { field: 'discipleship_pastor', confidence: 76 };
  if (/\b(small\s*groups?|life\s*groups?|community\s*groups?|\bgroups?\b|connections?)\b/.test(t)) return { field: 'groups_leader', confidence: 70 };
  if (/\b(next\s*gen|nextgen|kids?|children'?s?|students?|youth|family\s+ministr|preschool)\b/.test(t)) return { field: 'nextgen_leader', confidence: 70 };
  if (/\b(missions?|outreach|global|local\s+missions?)\b/.test(t)) return { field: 'outreach_missions_leader', confidence: 70 };
  if (/\boperations?\b|\bops\b/.test(t)) return { field: 'operations_leader', confidence: 78 };
  // Marketing — "digital" counts as marketing, and it ranks ABOVE comms.
  if (/\b(marketing|digital)\b/.test(t)) return { field: 'marketing_director', confidence: 74 };
  if (/\b(communications?|comms|creative|media|engagement)\b/.test(t)) return { field: 'communications_leader', confidence: 72 };
  return null;
}

/** Count how many cards map to a known relationship role. */
export function rolesDetected(cards: StaffCard[]): number {
  return cards.filter((c) => roleFromTitle(c.title) != null).length;
}
