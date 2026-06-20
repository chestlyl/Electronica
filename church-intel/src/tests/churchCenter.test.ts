/**
 * Church Center (Planning Center) platform-signal extraction.
 *
 * A *.churchcenter.com URL is strong evidence of a Planning Center / Church Center
 * stack. It is SUPPORTING platform evidence — never the official website / identity.
 * Uses OFH's real Church Center URL.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { detectDigitalSignals, isChurchCenterUrl } from '../research/digitalSignals.js';
import { extractFacts } from '../research/extractors.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Church Center → Planning Center platform evidence');

  check('isChurchCenterUrl matches the OFH Church Center URL', () => {
    assert.ok(isChurchCenterUrl('https://our-finest-hour-church.churchcenter.com/people/forms/929885'));
    assert.ok(isChurchCenterUrl('https://x.churchcenteronline.com/giving'));
    assert.ok(!isChurchCenterUrl('https://www.ofhchurch.com/staff'));
  });

  // OFH Church Center form page with the visible nav (Calendar / Give / Groups / Log in).
  const cc: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets',
    url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885',
    title: 'Our Finest Hour Church, Inc.', fetched: false, status: 200,
    snippet: 'Our Finest Hour Church, Inc. Calendar Give Groups Log in. Email, phone, address. assets@ofhchurch.com 9182791243',
  });

  const sig = detectDigitalSignals([cc]);
  check('platforms include Planning Center + Church Center', () => assert.ok(sig.platforms.includes('Planning Center') && sig.platforms.includes('Church Center')));
  check('church_management_platform = Planning Center', () => assert.strictEqual(sig.church_management_platform, 'Planning Center'));
  check('church_app true (Church Center is an app)', () => assert.ok(sig.church_app));
  check('online_giving true (nav contains Give)', () => assert.ok(sig.online_giving));
  check('groups_platform_present true (nav contains Groups)', () => assert.ok(sig.groups_platform_present));
  check('calendar_platform_present true (nav contains Calendar)', () => assert.ok(sig.calendar_platform_present));

  const facts = extractFacts([cc]);
  check('fact app_status = active', () => assert.strictEqual(facts.app_status?.value, 'active'));
  check('fact app_provider = Church Center / Planning Center', () => assert.strictEqual(facts.app_provider?.value, 'Church Center / Planning Center'));
  check('fact church_management_platform = Planning Center', () => assert.strictEqual(facts.church_management_platform?.value, 'Planning Center'));
  check('fact online_giving_present = true', () => assert.strictEqual(facts.online_giving_present?.value, true));
  check('fact groups_platform_present = true', () => assert.strictEqual(facts.groups_platform_present?.value, true));
  check('fact calendar_platform_present = true', () => assert.strictEqual(facts.calendar_platform_present?.value, true));

  // A Church Center URL with NO module words still proves the platform stack.
  const bare: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets',
    url: 'https://our-finest-hour-church.churchcenter.com/registrations', fetched: false, status: 200,
    title: 'Registrations', snippet: 'Sign up for an event.',
  });
  const bareSig = detectDigitalSignals([bare]);
  check('bare Church Center URL alone → Planning Center evidence', () => {
    assert.strictEqual(bareSig.church_management_platform, 'Planning Center');
    assert.ok(bareSig.church_app && bareSig.platforms.includes('Planning Center'));
  });
  check('bare Church Center facts still set app_status/app_provider', () => {
    const bf = extractFacts([bare]);
    assert.strictEqual(bf.app_status?.value, 'active');
    assert.strictEqual(bf.app_provider?.value, 'Church Center / Planning Center');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
