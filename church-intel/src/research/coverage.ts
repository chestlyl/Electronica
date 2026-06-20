import type { SourceFinding } from './dossier.js';
import type { LinkDiagnostic } from './types.js';
import type { Facts } from './extractors.js';
import type { DigitalSignals } from './digitalSignals.js';

/**
 * Minimum-evidence coverage model. Diagnostic only — no schema, no scoring
 * change. Records, per evidence category, whether it was found / fetched /
 * rendered / useful so the system can attach HONEST confidence to its
 * conclusions instead of forming strong opinions from missing evidence.
 */
export interface CoverageRow {
  category: string;
  required: boolean;
  found: boolean;     // a link to it was discovered, or a page of this kind was fetched
  fetched: boolean;   // a page of this category was retrieved (HTTP 2xx)
  rendered: boolean;  // that page used the rendered (Playwright) DOM
  useful: boolean;    // it actually yielded the intelligence the category exists for
  note: string;
}

const ROLE_FACTS = ['lead_pastor', 'executive_pastor', 'operations_leader', 'communications_leader'];
export function rolesInFacts(facts: Facts): number {
  return ROLE_FACTS.filter((k) => facts[k]?.value != null && facts[k]?.value !== '').length;
}

export function computeCoverage(findings: SourceFinding[], links: LinkDiagnostic[], facts: Facts, digital: DigitalSignals): CoverageRow[] {
  const fetched = (cats: string[]) => findings.find((f) => f.fetched && cats.includes(f.category ?? ''));
  const linkFound = (cats: string[]) => links.some((l) => cats.includes(l.category ?? ''));
  const textLen = (f?: SourceFinding) => (f?.renderedTextLength ?? f?.text?.length ?? 0);

  const home = findings.find((f) => f.category === 'home');
  const staff = fetched(['staff', 'leadership']);
  const contact = fetched(['contact']);
  const about = fetched(['about']);
  const ministries = fetched(['ministries']);
  const sermons = fetched(['sermons', 'locations', 'missions']);

  const roleCount = rolesInFacts(facts);
  const hasContact = (facts.office_email?.value != null && facts.office_email.value !== '') || (facts.office_phone?.value != null && facts.office_phone.value !== '');

  const row = (
    category: string, required: boolean, finding: SourceFinding | undefined,
    foundExtra: boolean, useful: boolean, note: string,
  ): CoverageRow => ({
    category, required,
    found: !!finding || foundExtra,
    fetched: !!finding,
    rendered: finding?.crawlMethod === 'playwright_rendered',
    useful, note,
  });

  return [
    row('homepage', true, home, !!home, !!home && textLen(home) > 200, `text ${textLen(home)}`),
    row('staff', true, staff, linkFound(['staff', 'leadership']),
      !!staff && (roleCount > 0 || (facts.staff_count?.value != null)),
      staff ? `roles detected: ${roleCount}, staff_count ${facts.staff_count?.value ?? '—'}` : 'staff page unavailable'),
    row('contact', true, contact, linkFound(['contact']),
      hasContact, hasContact ? `email/phone found` : (contact ? 'contact page fetched, no email/phone parsed' : 'contact page unavailable')),
    row('about', true, about, linkFound(['about']),
      !!about && (facts.founded_year?.value != null || textLen(about) > 300),
      about ? `text ${textLen(about)}${facts.founded_year?.value ? `, founded ${facts.founded_year.value}` : ''}` : 'about page unavailable'),
    // Optional categories — diagnostic; the system may proceed without these.
    row('ministries', false, ministries, linkFound(['ministries']), !!ministries, ministries ? 'fetched' : 'not collected'),
    row('giving', false, undefined, digital.online_giving, digital.online_giving,
      digital.online_giving ? `giving detected${digital.platforms.length ? ` (${digital.platforms.join(', ')})` : ''}` : 'no giving signal'),
    row('sermons', false, sermons, digital.youtube || digital.livestream || digital.podcast,
      digital.youtube || digital.livestream || digital.podcast,
      [digital.livestream && 'livestream', digital.youtube && 'YouTube', digital.podcast && 'podcast'].filter(Boolean).join(', ') || 'no media signal'),
    row('app', false, undefined, digital.church_app, digital.church_app,
      digital.church_app ? `app${digital.platforms.length ? ` (${digital.platforms.join(', ')})` : ''}` : 'no app signal'),
  ];
}

export type Tier = 'Low' | 'Medium' | 'High';
export interface ScoreConfidence { confidence: number; tier: Tier; reason: string }

const TIER_CONF: Record<Tier, number> = { Low: 38, Medium: 55, High: 76 };
const conf = (tier: Tier, reason: string): ScoreConfidence => ({ confidence: TIER_CONF[tier], tier, reason });

/**
 * Coverage-aware CONFIDENCE for a strategic score (the score VALUE is unchanged —
 * still produced by synthesis). Confidence reflects whether the evidence the
 * score depends on was actually collected.
 */
export function scoreConfidence(metric: string, coverage: CoverageRow[], digital: DigitalSignals): ScoreConfidence {
  const cov = (c: string) => coverage.find((x) => x.category === c);
  const requiredFetched = coverage.filter((c) => c.required && c.fetched).length;

  switch (metric) {
    case 'staff_depth_score': {
      const s = cov('staff');
      if (s?.useful && s.rendered) return conf('High', `staff page rendered; ${s.note}`);
      if (s?.useful) return conf('Medium', `staff page fetched; ${s.note}`);
      if (s?.fetched) return conf('Low', 'staff page fetched but no roles extracted');
      return conf('Low', 'staff page unavailable');
    }
    case 'digital_maturity_score': {
      const n = digital.signalsDetected;
      if (n >= 4) return conf('High', `${n} digital signals detected`);
      if (n >= 2) return conf('Medium', `${n} digital signals detected`);
      return conf('Low', `only ${n} digital signal(s) found`);
    }
    case 'growth_orientation_score':
    case 'change_readiness_score': {
      if (requiredFetched >= 3) return conf('High', `${requiredFetched}/4 required pages fetched`);
      if (requiredFetched === 2) return conf('Medium', '2/4 required pages fetched');
      return conf('Low', `${requiredFetched}/4 required pages fetched`);
    }
    default:
      return conf('Medium', 'coverage not assessed');
  }
}

/** Coverage-aware confidence for the derived contactability score. */
export function contactabilityConfidence(coverage: CoverageRow[]): ScoreConfidence {
  const c = coverage.find((x) => x.category === 'contact');
  const staff = coverage.find((x) => x.category === 'staff');
  if (c?.useful && staff?.useful) return conf('High', 'contact + staff intelligence collected');
  if (c?.useful || staff?.useful) return conf('Medium', 'partial contact/staff intelligence');
  return conf('Low', 'no contact email/phone or staff roles collected');
}
