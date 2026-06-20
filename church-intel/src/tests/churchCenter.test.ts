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
import { detectTechStack, technologyStack, classifyPlatform } from '../research/techStack.js';
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

  // ── Technology-stack layer (deterministic hostname mapping) ───────────────
  check('classifyPlatform maps every required host', () => {
    assert.strictEqual(classifyPlatform('https://x.churchcenter.com/a')?.platform, 'Church Center / Planning Center');
    assert.strictEqual(classifyPlatform('https://planningcenteronline.com')?.platform, 'Planning Center');
    assert.strictEqual(classifyPlatform('https://pushpay.com/g/abc')?.platform, 'Pushpay');
    assert.strictEqual(classifyPlatform('https://subsplash.com/x')?.platform, 'Subsplash');
    assert.strictEqual(classifyPlatform('https://tithe.ly/give')?.platform, 'Tithely');
    assert.strictEqual(classifyPlatform('https://breezechms.com')?.platform, 'Breeze');
    assert.strictEqual(classifyPlatform('https://realm.org/x')?.platform, 'ACS Realm');
    assert.strictEqual(classifyPlatform('https://flocknote.com')?.platform, 'Flocknote');
    assert.strictEqual(classifyPlatform('https://us1.mailchimp.com/x')?.platform, 'Mailchimp');
    assert.strictEqual(classifyPlatform('https://static1.squarespace.com/x.css')?.platform, 'Squarespace');
    assert.strictEqual(classifyPlatform('https://church.wixsite.com/home')?.platform, 'Wix');
    assert.strictEqual(classifyPlatform('https://www.ofhchurch.com'), null);
  });

  // A dossier whose findings reference several platforms across URLs + links + text.
  const home = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/', fetched: true, status: 200,
    title: 'Our Finest Hour', text: 'Give online at https://ofh.churchcenter.com/giving . Built with images.squarespace-cdn.com assets.',
    linkDiagnostics: [{ anchorText: 'Give', href: '/give', resolvedUrl: 'https://pushpay.com/g/ofh', sameOrigin: false, category: 'contact', selected: false, fetched: false, textLength: 0, hasStaffContactSignal: false, discovery: 'homepage_link' }],
  });
  const snip = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets', url: 'https://ofh.churchcenter.com/people/forms/929885', fetched: false, status: 200,
    title: 'OFH', snippet: 'Donate via tithe.ly/give/ofh and flocknote.com signup.',
  });
  const stack = detectTechStack([home, snip]);
  const names = technologyStack(stack);
  check('tech stack detects Church Center / Planning Center (Church Center host)', () => assert.ok(names.includes('Church Center / Planning Center')));
  check('tech stack detects Pushpay (outbound link)', () => assert.ok(names.includes('Pushpay')));
  check('tech stack detects Tithely (text host)', () => assert.ok(names.includes('Tithely')));
  check('tech stack detects Flocknote (text host)', () => assert.ok(names.includes('Flocknote')));
  check('tech stack detects Squarespace (cdn host in text)', () => assert.ok(names.includes('Squarespace')));
  check('every hit has platform_name, category, confidence, evidence_url', () => {
    for (const t of stack) { assert.ok(t.platform_name && t.category && t.confidence > 0 && /^https?:\/\//.test(t.evidence_url)); }
  });
  check('no duplicate platforms', () => assert.strictEqual(new Set(names).size, names.length));

  // ── OFH regression: the exact live Church Center URL ──────────────────────
  const ofh: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets',
    url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885',
    title: 'Our Finest Hour Church, Inc.', fetched: false, status: 200,
    snippet: 'Our Finest Hour Church, Inc. Calendar Give Groups Log in. Form: email phone address. assets@ofhchurch.com 9182791243',
  });
  const ofhStack = detectTechStack([ofh]);
  const ofhSig = detectDigitalSignals([ofh]);
  const ofhFacts = extractFacts([ofh]);
  check('OFH: tech stack = Church Center / Planning Center', () => assert.deepStrictEqual(technologyStack(ofhStack), ['Church Center / Planning Center']));
  check('OFH: platform hit has the exact churchcenter evidence_url', () => assert.ok(ofhStack[0].evidence_url.includes('our-finest-hour-church.churchcenter.com')));
  check('OFH: Planning Center / Church Center app facts set', () => {
    assert.strictEqual(ofhFacts.app_status?.value, 'active');
    assert.strictEqual(ofhFacts.app_provider?.value, 'Church Center / Planning Center');
    assert.strictEqual(ofhFacts.church_management_platform?.value, 'Planning Center');
  });
  check('OFH: Give / Groups / Calendar detected from nav', () => {
    assert.ok(ofhSig.online_giving && ofhSig.groups_platform_present && ofhSig.calendar_platform_present);
    assert.strictEqual(ofhFacts.online_giving_present?.value, true);
    assert.strictEqual(ofhFacts.groups_platform_present?.value, true);
    assert.strictEqual(ofhFacts.calendar_platform_present?.value, true);
  });
  check('OFH: form + login present on the page evidence', () => { assert.match(ofh.snippet ?? '', /\bform\b/i); assert.match(ofh.snippet ?? '', /\blog ?in\b/i); });
  check('OFH: Church Center is SUPPORTING evidence, not the official site', () => {
    // techStack/digital are platform evidence only; identity (sourceType) is unchanged.
    assert.notStrictEqual(ofh.sourceType, 'official_site');
    assert.strictEqual(ofh.accessLevel, 'search_snippets');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
