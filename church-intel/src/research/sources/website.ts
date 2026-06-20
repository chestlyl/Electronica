import { makeFinding, type ExtractedField, type SourceFinding, type SourceType } from '../dossier.js';
import { roleFromTitle } from '../staffCards.js';
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
    // Rendered-DOM extractions: mailto/tel links + staff-card text.
    for (const email of page.mailto ?? []) push('email', email, 88, 'mailto link on rendered site');
    for (const t of page.tel ?? []) push('phone', t, 85, 'tel link on rendered site');

    // Staff cards (name + title) parsed from rendered staff/leadership pages →
    // structured role fields + a staff_count. extractFacts folds these into the
    // facts (text-derived facts still win on higher confidence).
    const cards = page.staffCards ?? [];
    for (const card of cards) {
      const role = roleFromTitle(card.title);
      if (role) push(role.field, card.name, role.confidence, `Staff card: ${card.name} — ${card.title}`);
    }
    if (cards.length) push('staff_count', cards.length, 70, `${cards.length} staff cards on ${page.category} page`);

    // Append staff-card lines (and any card-block text) so synthesis/extractors
    // also see the names + titles.
    const cardLines = cards.map((c) => `${c.name} — ${c.title}`);
    const staffText = [...cardLines, ...(page.staffBlocks ?? [])].join(' • ');
    const text = (page.text + (staffText ? `\n\nSTAFF CARDS: ${staffText}` : '')).slice(0, 5000);

    findings.push(makeFinding({
      sourceType,
      accessLevel: 'live_official_site',
      url: page.finalUrl,
      title: page.title,
      fetched: true,
      status: page.status,
      text,
      fields,
      crawlMethod: page.crawlMethod,
      rawTextLength: page.rawTextLength,
      renderedTextLength: page.renderedTextLength,
      renderedGainRatio: page.renderedGainRatio,
      // Attach the per-link crawl trace to the homepage finding so the dossier /
      // calibration report can explain which links were (not) crawled.
      linkDiagnostics: page.category === 'home' ? bundle.linkDiagnostics : undefined,
    }));
  }
  return findings;
}
