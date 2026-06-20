import type { SourceFinding } from './dossier.js';

/**
 * Deterministic digital-maturity EVIDENCE detection (no scoring change).
 * Scans the gathered evidence for giving methods, ChMS/giving/app platforms,
 * and media presence. These signals feed the digital-maturity CONFIDENCE +
 * evidence summary and the synthesis prompt — they do not redefine the score.
 */
export interface DigitalSignals {
  online_giving: boolean;
  recurring_giving: boolean;
  apple_pay: boolean;
  google_pay: boolean;
  text_to_give: boolean;
  stock_giving: boolean;
  crypto_giving: boolean;
  daf_giving: boolean;
  platforms: string[];        // Church Center / Planning Center / Subsplash / ...
  livestream: boolean;
  youtube: boolean;
  podcast: boolean;
  online_campus: boolean;
  church_app: boolean;
  signalsDetected: number;    // count of positively determined signals
}

const PLATFORMS: { name: string; re: RegExp }[] = [
  { name: 'Church Center', re: /church\s*center|churchcenter/i },
  { name: 'Planning Center', re: /planning\s*center|planningcenter/i },
  { name: 'Subsplash', re: /subsplash|thechurchapp/i },
  { name: 'Pushpay', re: /pushpay/i },
  { name: 'Tithe.ly', re: /tithe\.?ly|tithely/i },
  { name: 'Rock RMS', re: /rock\s*rms|rockrms/i },
  { name: 'Breeze', re: /breezechms|breeze\s*chms/i },
  { name: 'Realm', re: /\brealm\b\s*(?:church|chms|connect)?|onrealm/i },
  { name: 'Flocknote', re: /flocknote/i },
];

export function detectDigitalSignals(findings: SourceFinding[]): DigitalSignals {
  const hay = findings
    .map((f) => `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''} ${f.url} ${f.fields.map((x) => `${x.field_name}=${x.value}`).join(' ')}`)
    .join(' \n ');
  const has = (re: RegExp) => re.test(hay);
  const platforms = PLATFORMS.filter((p) => p.re.test(hay)).map((p) => p.name);

  const sig: Omit<DigitalSignals, 'signalsDetected'> = {
    online_giving: has(/online giving|give online|give now|ways to give|\bdonate\b|\/give\b|\/giving\b/i),
    recurring_giving: has(/recurring (?:gift|giving|donation)|set up (?:a )?recurring|auto(?:matic)? giving|schedule (?:a )?gift/i),
    apple_pay: has(/apple\s*pay/i),
    google_pay: has(/google\s*pay/i),
    text_to_give: has(/text[- ]?to[- ]?give|give by text|text\s+\w+\s+to\s+\d{5,6}/i),
    stock_giving: has(/stocks?\s*(?:gift|giving|donation|transfer)|gifts?\s+of\s+stock|appreciated securities|\bsecurities\b/i),
    crypto_giving: has(/crypto(?:currency)?|bitcoin|\bethereum\b|digital currency/i),
    daf_giving: has(/donor[- ]advised|donor advised fund|\bdaf\b/i),
    platforms,
    livestream: has(/livestream|live stream|watch live|streaming|live online|watch now/i),
    youtube: has(/youtube\.com|youtu\.be/i),
    podcast: has(/\bpodcast\b|apple podcasts|spotify\.com\/show|anchor\.fm/i),
    online_campus: has(/online campus|church online|watch online|virtual campus/i),
    church_app: has(/download (?:our|the) app|mobile app|\bour app\b|app store|apps\.apple\.com|play\.google\.com\/store\/apps/i)
      || platforms.includes('Subsplash') || platforms.includes('Church Center'),
  };

  const bools = [
    sig.online_giving, sig.recurring_giving, sig.apple_pay, sig.google_pay, sig.text_to_give,
    sig.stock_giving, sig.crypto_giving, sig.daf_giving, sig.livestream, sig.youtube,
    sig.podcast, sig.online_campus, sig.church_app,
  ];
  const signalsDetected = bools.filter(Boolean).length + (platforms.length ? 1 : 0);
  return { ...sig, signalsDetected };
}

/** Compact human-readable evidence summary for the report + synthesis prompt. */
export function digitalEvidenceSummary(d: DigitalSignals): string {
  const giving: string[] = [];
  if (d.online_giving) giving.push('online');
  if (d.recurring_giving) giving.push('recurring');
  if (d.apple_pay) giving.push('Apple Pay');
  if (d.google_pay) giving.push('Google Pay');
  if (d.text_to_give) giving.push('text-to-give');
  if (d.stock_giving) giving.push('stock');
  if (d.crypto_giving) giving.push('crypto');
  if (d.daf_giving) giving.push('DAF');
  const media: string[] = [];
  if (d.livestream) media.push('livestream');
  if (d.youtube) media.push('YouTube');
  if (d.podcast) media.push('podcast');
  if (d.online_campus) media.push('online campus');
  if (d.church_app) media.push('app');
  return [
    `giving: ${giving.length ? giving.join(', ') : 'none detected'}`,
    `platforms: ${d.platforms.length ? d.platforms.join(', ') : 'none detected'}`,
    `media: ${media.length ? media.join(', ') : 'none detected'}`,
  ].join(' · ');
}
