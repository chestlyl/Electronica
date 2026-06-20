import { makeFinding, type ExtractedField, type SourceFinding, type SourceType } from '../dossier.js';
import type { ResearchContext } from './context.js';

function categoryToSourceType(category: string): SourceType {
  switch (category) {
    case 'staff':
    case 'leadership': return 'staff_page';
    case 'contact': return 'contact_page';
    case 'about': return 'about_history';
    case 'locations':
    case 'sermons':
    case 'missions': return 'sermon_livestream';
    default: return 'official_site';
  }
}

const SOCIAL_LINK = /(facebook\.com|instagram\.com|youtube\.com|youtu\.be)\/[^\s"'<)]+/gi;
const PHONE = /\(?\b\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/;
const PASTOR = /\b(lead|senior|associate|executive|founding)\s+pastor\b/i;

/**
 * WebsiteCollector — crawls the identity-confirmed official site via the
 * resilient (Playwright → fetch) provider. Pages actually retrieved are
 * `live_official_site`; if the DOM could not be fetched, NO live finding is
 * emitted (so the dossier correctly caps confidence).
 */
export async function collectWebsite(ctx: ResearchContext): Promise<SourceFinding[]> {
  if (!ctx.officialSite) return [];
  const bundle = await ctx.research.research({
    name: ctx.name,
    city: ctx.city,
    state: ctx.state,
    originalWebsite: ctx.officialSite,
    originalPhone: null,
    originalEmail: null,
    alternateName: ctx.alternateName,
    // Discovery already ran in the dossier identity step; crawl this site
    // directly instead of re-discovering it.
    preResolvedOfficialSite: ctx.officialSite,
  });

  const findings: SourceFinding[] = [];
  for (const page of bundle.pages) {
    if (!page.ok) continue;
    const sourceType = categoryToSourceType(page.category);
    const fields: ExtractedField[] = [];
    const push = (name: string, value: string | number | null, conf: number, ev: string) =>
      fields.push({
        field_name: name, value, confidence: conf, evidence_text: ev,
        source_url: page.finalUrl, source_type: sourceType, access_level: 'live_official_site',
      });

    const phone = page.text.match(PHONE);
    if (phone && (page.category === 'contact' || page.category === 'home')) {
      push('phone', phone[0], 80, `Phone on ${page.category} page`);
    }
    if (PASTOR.test(page.text) && (page.category === 'staff' || page.category === 'leadership')) {
      push('lead_pastor_title_mention', page.text.match(PASTOR)![0], 70, 'Pastor title on staff page');
    }
    for (const m of page.text.matchAll(SOCIAL_LINK)) {
      push('social_link', 'https://' + m[0].replace(/^https?:\/\//, ''), 75, 'Social link on official site');
    }

    findings.push(makeFinding({
      sourceType,
      accessLevel: 'live_official_site',
      url: page.finalUrl,
      title: page.title,
      fetched: true,
      status: page.status,
      text: page.text.slice(0, 4000),
      fields,
    }));
  }
  return findings;
}
