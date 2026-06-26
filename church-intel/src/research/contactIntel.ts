import type { SourceFinding } from './dossier.js';
import type { NormalizedEvidence, NormalizedRow, Interpretation } from './evidenceModel.js';
import type { EvidenceAccessLevel } from '../types.js';

/**
 * Contact Intelligence Layer (Stage 2 — extraction, no invention).
 *
 * Organizes EVERY contact channel the crawl actually found into the buckets a
 * relationship team works from:
 *   - church-level emails (info@, office@, hello@…)
 *   - role-based emails    (giving@, missions@, kids@…), also grouped by department
 *   - person-matched emails (attributed to a named staff member)
 *   - unassigned emails    (preserved, never discarded)
 *   - contact forms        (a /contact page with a real submit form)
 *   - campus contacts      (per-location address + nearest phone)
 *   - phones               (deduped by digits)
 *
 * Nothing here is invented: every channel carries its source_url + confidence and
 * derives only from collected evidence (the email map, the location table, and the
 * phone/contact fields on the findings). It makes no strategic judgments — that is
 * the recommendation/outreach layer's job.
 */

export interface ContactChannel {
  value: string;
  label: string | null;            // person name, role hint, or department
  source_url: string;
  access_level: EvidenceAccessLevel;
  confidence: number;
}
export interface DepartmentContacts {
  department: string;
  emails: ContactChannel[];
}
export interface ContactForm {
  url: string;
  evidence: string;
  access_level: EvidenceAccessLevel;
}
export interface CampusContact {
  name: string;
  address: string | null;
  phone: string | null;
  source_url: string;
}
export interface ContactIntelligence {
  primary_email: string | null;
  primary_phone: string | null;
  church_emails: ContactChannel[];
  role_emails: ContactChannel[];
  person_emails: ContactChannel[];
  unassigned_emails: ContactChannel[];
  departments: DepartmentContacts[];
  contact_forms: ContactForm[];
  campus_contacts: CampusContact[];
  phones: ContactChannel[];
}

export interface ContactIntelInput {
  findings: SourceFinding[];
  normalized: NormalizedEvidence;
  interpretation: Interpretation;
}

// Map a role mailbox / role hint to a human department label. Order matters:
// the FIRST pattern that matches wins, so specific buckets precede general ones.
const DEPARTMENTS: { dept: string; re: RegExp }[] = [
  { dept: 'Finance & Giving', re: /\b(giving|give|donate|donations?|finance|generosity|stewardship|tithe)\b/i },
  { dept: 'Outreach & Missions', re: /\b(missions?|outreach|global|local\s*missions?)\b/i },
  { dept: 'NextGen & Family', re: /\b(kids?|children'?s?|students?|youth|nextgen|next\s*gen|family|families|preschool)\b/i },
  { dept: 'Groups & Connection', re: /\b(groups?|connect|connections?|community)\b/i },
  { dept: 'Care & Prayer', re: /\b(care|prayer|counsel(?:ing)?|support)\b/i },
  { dept: 'Worship & Production', re: /\b(worship|music|media|production|tech(?:nical)?|sound)\b/i },
  { dept: 'Communications', re: /\b(comms?|communications?|marketing|digital|creative)\b/i },
  { dept: 'Events', re: /\b(events?|weddings?|hospitality\s*events?)\b/i },
  { dept: 'Operations & HR', re: /\b(hr|human\s*resources|jobs?|careers?|employment|facilities|admin(?:istration)?)\b/i },
  { dept: 'Serve & Hospitality', re: /\b(volunteer|serve|guest|hospitality|first\s*impressions|welcome)\b/i },
  { dept: 'Pastoral / Leadership', re: /\b(pastors?|pastor|staff|leadership|elders?)\b/i },
];
function departmentOf(text: string): string {
  for (const d of DEPARTMENTS) if (d.re.test(text)) return d.dept;
  return 'Other';
}

const toChannel = (r: NormalizedRow): ContactChannel => ({
  value: r.value, label: r.detail ?? null, source_url: r.source_url, access_level: r.access_level, confidence: Math.round(r.confidence),
});

// A general "the church" mailbox (used to pick the primary email).
const CHURCH_GENERAL = /^(info|office|contact|hello|hi|welcome|admin|church|mail|general)\b/i;

// ── contact-form detection ───────────────────────────────────────────────────
// A real "send us a message" form, distinguished from a page that only lists an
// address/phone. Either an explicit form phrase, or ≥3 distinct form-field labels.
const FORM_PHRASE = /\b(send us a message|contact form|fill out (?:the|this) form|how can we help|drop us a (?:line|message|note)|get in touch|send (?:us )?a message|we'?d love to hear from you|message us)\b/i;
const FORM_FIELD = /\b(first name|last name|full name|your name|your email|email address|phone number|your message|message|subject|comments?|submit|send message|required)\b/gi;

function detectContactForms(findings: SourceFinding[]): ContactForm[] {
  const forms: ContactForm[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (!f.fetched) continue;
    const isContact = f.category === 'contact' || /\/contact/i.test(f.url);
    if (!isContact && f.category !== 'home') continue;
    const text = `${f.title ?? ''} ${f.text ?? ''}`;
    const phrase = text.match(FORM_PHRASE);
    const fields = new Set((text.match(FORM_FIELD) ?? []).map((m) => m.toLowerCase()));
    // Home page needs the explicit phrase (its field-label noise is unreliable);
    // a dedicated contact page can also qualify on ≥3 distinct field labels.
    const qualifies = phrase || (isContact && fields.size >= 3);
    if (!qualifies) continue;
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    forms.push({
      url: f.url,
      evidence: phrase ? `form copy: "${phrase[0]}"` : `${fields.size} form fields detected (${[...fields].slice(0, 4).join(', ')})`,
      access_level: f.accessLevel,
    });
  }
  return forms;
}

// ── phones ───────────────────────────────────────────────────────────────────
const digits = (s: string) => s.replace(/\D/g, '');
function collectPhones(findings: SourceFinding[], interpretation: Interpretation): ContactChannel[] {
  const byDigits = new Map<string, ContactChannel>();
  const add = (value: string, label: string | null, source_url: string, access: EvidenceAccessLevel, confidence: number) => {
    const d = digits(value);
    if (d.length < 10 || d.length > 11) return; // not a US phone
    const existing = byDigits.get(d);
    if (!existing || confidence > existing.confidence) byDigits.set(d, { value: value.trim(), label, source_url, access_level: access, confidence: Math.round(confidence) });
  };
  for (const f of findings) {
    for (const field of f.fields) {
      if (field.field_name === 'phone' && field.value) add(String(field.value), field.evidence_text || null, field.source_url, field.access_level, field.confidence);
    }
  }
  // The interpreted office phone is canonical — surface it (it has no own URL).
  const op = interpretation.office_phone;
  if (op.value) add(op.value, 'office', '', op.access_level, op.confidence);
  return [...byDigits.values()].sort((a, b) => b.confidence - a.confidence);
}

// ── campuses / locations ─────────────────────────────────────────────────────
function cityFromAddress(addr: string): string | null {
  const m = addr.match(/,\s*([A-Za-z .'-]{2,30}),\s*[A-Z]{2}\s+\d{5}/);
  return m ? m[1].trim() : null;
}
function buildCampusContacts(normalized: NormalizedEvidence, phones: ContactChannel[]): CampusContact[] {
  const out: CampusContact[] = [];
  const seen = new Set<string>();
  for (const loc of normalized.locations) {
    const key = loc.value.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const phone = phones.find((p) => p.source_url === loc.source_url)?.value ?? null;
    out.push({ name: cityFromAddress(loc.value) ?? 'Primary location', address: loc.value, phone, source_url: loc.source_url });
  }
  return out;
}

export function buildContactIntel(input: ContactIntelInput): ContactIntelligence {
  const { findings, normalized, interpretation } = input;
  const emails = normalized.email_map;
  const church_emails = emails.filter((e) => e.category === 'church').map(toChannel);
  const role_emails = emails.filter((e) => e.category === 'role').map(toChannel);
  const person_emails = emails.filter((e) => e.category === 'person').map(toChannel);
  const unassigned_emails = emails.filter((e) => e.category === 'unassigned').map(toChannel);

  // Departments — group role mailboxes by the function the local-part implies.
  const deptMap = new Map<string, ContactChannel[]>();
  for (const e of role_emails) {
    const dept = departmentOf(`${e.value.split('@')[0]} ${e.label ?? ''}`);
    const arr = deptMap.get(dept) ?? [];
    arr.push(e);
    deptMap.set(dept, arr);
  }
  const departments: DepartmentContacts[] = [...deptMap.entries()].map(([department, emails]) => ({ department, emails }));

  const phones = collectPhones(findings, interpretation);
  const campus_contacts = buildCampusContacts(normalized, phones);
  const contact_forms = detectContactForms(findings);

  // Primary email: a general church mailbox first, else any role mailbox, else the
  // interpreted office email. Never invented — always a real collected address.
  const primary_email =
    church_emails.find((e) => CHURCH_GENERAL.test(e.value.split('@')[0]))?.value ??
    church_emails[0]?.value ??
    role_emails[0]?.value ??
    interpretation.office_email.value ??
    null;
  const primary_phone = interpretation.office_phone.value ?? phones[0]?.value ?? null;

  return {
    primary_email, primary_phone,
    church_emails, role_emails, person_emails, unassigned_emails,
    departments, contact_forms, campus_contacts, phones,
  };
}
