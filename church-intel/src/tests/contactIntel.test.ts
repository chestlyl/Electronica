/**
 * Contact Intelligence Layer (Priority 2) — organizes every found contact channel
 * into church/role/person/unassigned emails, departments, contact forms, campus
 * contacts, and deduped phones. Proves nothing is invented (every channel cites a
 * source) and nothing is dropped.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildContactIntel } from '../research/contactIntel.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { emptyNormalizedEvidence, type Interpretation, type Conclusion } from '../research/evidenceModel.js';
import type { EvidenceAccessLevel } from '../types.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const conc = <T>(value: T): Conclusion<T> => ({ value, confidence: 80, evidence_ids: [], reason: 'test', access_level: 'live_official_site' });
function phoneField(value: string, url: string) {
  return { field_name: 'phone', value, confidence: 80, evidence_text: 'phone on page', source_url: url, source_type: 'official_site' as const, access_level: 'live_official_site' as EvidenceAccessLevel };
}
function emailRow(id: string, value: string, category: string, detail: string, source_url: string) {
  return { id, value, category, detail, source_url, evidence_text: value, confidence: 70, access_level: 'live_official_site' as EvidenceAccessLevel, extractor_name: 'emailMap' };
}
function locRow(id: string, value: string, source_url: string) {
  return { id, value, category: 'address', source_url, evidence_text: value, confidence: 65, access_level: 'live_official_site' as EvidenceAccessLevel, extractor_name: 'addressRegex' };
}

async function main() {
  console.log('Contact Intelligence Layer');

  const HOME = 'https://church.org/';
  const CONTACT = 'https://church.org/contact';
  const DAYTON = 'https://church.org/dayton';

  const findings: SourceFinding[] = [
    makeFinding({ sourceType: 'contact_page', accessLevel: 'live_official_site', url: CONTACT, fetched: true, status: 200, category: 'contact',
      title: 'Contact Us', text: 'Send us a message. First Name Last Name Email Address Your Message Submit. 123 Main St, Springfield, OH 45501',
      fields: [phoneField('(555) 111-2222', HOME)] }),
    makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url: HOME, fetched: true, status: 200, category: 'home',
      title: 'Home', text: '123 Main St, Springfield, OH 45501. Call us (555) 111-2222.', fields: [phoneField('(555) 111-2222', HOME)] }),
    makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url: DAYTON, fetched: true, status: 200, category: 'locations',
      title: 'Dayton Campus', text: '900 Oak Ave, Dayton, OH 45402', fields: [phoneField('(555) 333-4444', DAYTON)] }),
  ];

  const normalized = emptyNormalizedEvidence();
  normalized.email_map.push(
    emailRow('email_1', 'info@church.org', 'church', 'info', HOME),
    emailRow('email_2', 'giving@church.org', 'role', 'giving', HOME),
    emailRow('email_3', 'kids@church.org', 'role', 'kids', HOME),
    emailRow('email_4', 'j.smith@church.org', 'person', 'John Smith', '' + 'https://church.org/staff'),
    emailRow('email_5', 'papa@gmail.com', 'unassigned', 'personal webmail', HOME),
  );
  normalized.locations.push(
    locRow('location_1', '123 Main St, Springfield, OH 45501', HOME),
    locRow('location_2', '900 Oak Ave, Dayton, OH 45402', DAYTON),
  );

  const interpretation = {
    office_email: conc<string | null>('info@church.org'),
    office_phone: conc<string | null>('(555) 111-2222'),
  } as unknown as Interpretation;

  const ci = buildContactIntel({ findings, normalized, interpretation });

  check('emails bucketed correctly (1 church, 2 role, 1 person, 1 unassigned)', () => {
    assert.strictEqual(ci.church_emails.length, 1);
    assert.strictEqual(ci.role_emails.length, 2);
    assert.strictEqual(ci.person_emails.length, 1);
    assert.strictEqual(ci.unassigned_emails.length, 1);
  });
  check('unassigned personal webmail is PRESERVED, not dropped', () => {
    assert.ok(ci.unassigned_emails.some((e) => e.value === 'papa@gmail.com'));
  });
  check('role emails grouped into departments (Finance & Giving, NextGen & Family)', () => {
    const depts = ci.departments.map((d) => d.department);
    assert.ok(depts.includes('Finance & Giving'), `got ${depts.join(', ')}`);
    assert.ok(depts.includes('NextGen & Family'), `got ${depts.join(', ')}`);
  });
  check('contact form detected on the contact page', () => {
    assert.ok(ci.contact_forms.length >= 1);
    assert.strictEqual(ci.contact_forms[0].url, CONTACT);
  });
  check('campus contacts: 2 locations, each with its nearest phone', () => {
    assert.strictEqual(ci.campus_contacts.length, 2);
    const springfield = ci.campus_contacts.find((c) => c.name === 'Springfield');
    const dayton = ci.campus_contacts.find((c) => c.name === 'Dayton');
    assert.ok(springfield && springfield.phone === '(555) 111-2222', 'Springfield phone');
    assert.ok(dayton && dayton.phone === '(555) 333-4444', 'Dayton phone');
  });
  check('phones deduped by number (111-2222 appears once despite 2 sources)', () => {
    const same = ci.phones.filter((p) => p.value.replace(/\D/g, '') === '5551112222');
    assert.strictEqual(same.length, 1);
  });
  check('primary email is the general church mailbox; primary phone is the office line', () => {
    assert.strictEqual(ci.primary_email, 'info@church.org');
    assert.strictEqual(ci.primary_phone, '(555) 111-2222');
  });
  check('nothing invented: every email channel cites a source', () => {
    for (const e of [...ci.church_emails, ...ci.role_emails, ...ci.unassigned_emails]) assert.ok(e.source_url, `${e.value} missing source`);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
