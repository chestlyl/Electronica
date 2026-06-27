/**
 * The opportunity scout.
 *
 * Produces a list of concrete, low-capital, honest opportunities. It ships with
 * a built-in *vetted catalog* so the tool is fully useful offline and never
 * depends on a model hallucinating get-rich schemes. When an Anthropic key is
 * configured, `scoutWithClaude()` can extend the catalog with researched,
 * source-backed ideas — but those still pass through the same scoring and
 * integrity discipline, and the catalog is the trustworthy floor.
 *
 * Every catalog entry is deliberately a *service/product with a real buyer and a
 * real deliverable* — not speculation. The first entry productizes the
 * church-intel research engine that already lives in this repo.
 */
import { toCents } from './money.js';
import type { Opportunity } from './types.js';

/**
 * Hand-vetted starting opportunities. Numbers are deliberately conservative
 * (low-end first-month estimates) and each carries honest risks.
 */
export function vettedCatalog(): Opportunity[] {
  return [
    {
      id: 'research-as-a-service',
      title: 'Evidence-backed org/lead research as a service',
      summary:
        'Sell the church-intel engine\'s capability as a done-for-you research deliverable: ' +
        'given a list of organizations, return a verified, sourced dossier (website, contacts, ' +
        'size, classification) with confidence on every field. Sell to nonprofits, B2B sales ' +
        'teams, and associations who need clean, current lists.',
      category: 'research_service',
      startupCostCents: toCents(20), // API + a landing page; everything else is sweat equity
      expectedRevenue30dCents: toCents(150),
      hoursToFirstDollar: 8,
      evConfidence: 70,
      evidence: [
        'Working engine already exists in this repo (church-intel): verification, contact, ' +
          'denomination, size, scoring agents with evidence + confidence.',
        'Manual list-cleaning / lead-research is an established paid service (Upwork/Fiverr ' +
          'gigs exist for "lead list building" and "data enrichment").',
      ],
      risks: [
        'Requires a first buyer; cold start.',
        'Must respect each source\'s robots.txt and ToS (church-intel already does).',
        'Quality must be genuinely high or reputation suffers.',
      ],
      integrityBasis:
        'Public-data research only, every value carries its source and an honest confidence; ' +
        'no scraping behind logins, no guessed/private contact info, no spam outreach.',
    },
    {
      id: 'niche-digital-template',
      title: 'A single well-made digital template/tool',
      summary:
        'Build one genuinely useful artifact (e.g. a Notion/Sheets system, a small script, a ' +
        'checklist pack) for a niche you understand, and sell it on Gumroad/its marketplace.',
      category: 'digital_product',
      startupCostCents: toCents(0), // free tiers; cost is time
      expectedRevenue30dCents: toCents(80),
      hoursToFirstDollar: 12,
      evConfidence: 55,
      evidence: [
        'Digital products have ~zero marginal cost and established marketplaces.',
        'Free hosting/storefront tiers exist (Gumroad takes a per-sale cut, no upfront cost).',
      ],
      risks: [
        'Most templates sell little without an audience; distribution is the hard part.',
        'Easy to overestimate demand — validate before building.',
      ],
      integrityBasis:
        'Original work, honestly described; no copied/relabeled content, no fake scarcity or reviews.',
    },
    {
      id: 'helpful-moltbook-presence',
      title: 'Reputation-first presence on Moltbook',
      summary:
        'Participate honestly in relevant submolts (e.g. m/sideprojects, m/saas) by sharing ' +
        'genuinely useful findings from the research engine, clearly disclosed as an AI agent. ' +
        'Goal is reputation and inbound interest in the research service — never engagement farming.',
      category: 'distribution',
      startupCostCents: toCents(0),
      expectedRevenue30dCents: toCents(0), // indirect: a funnel, not a direct earner
      hoursToFirstDollar: 0,
      evConfidence: 40,
      evidence: [
        'Moltbook is a Reddit-style network for AI agents; honest, useful contributions can ' +
          'build reputation that feeds the research-service funnel.',
      ],
      risks: [
        'Newer platform; uncertain ROI.',
        'High integrity risk if misused (vote gaming, spam) — strictly gated by the integrity engine.',
        'No direct revenue; only supports other lines.',
      ],
      integrityBasis:
        'Discloses AI-agent identity on every post, contributes real value, never manipulates ' +
        'votes or markets, respects rate limits — all enforced by assessIntegrity().',
    },
    {
      id: 'freelance-microtask',
      title: 'Skill-matched freelance micro-engagements',
      summary:
        'Use the agent to find, scope, and draft proposals for small freelance tasks the operator ' +
        'can deliver (research, data cleanup, writing). The human applies and delivers; the agent ' +
        'does the legwork of finding fits and drafting honest proposals.',
      category: 'freelance',
      startupCostCents: toCents(0),
      expectedRevenue30dCents: toCents(120),
      hoursToFirstDollar: 6,
      evConfidence: 60,
      evidence: [
        'Freelance marketplaces have steady low-end demand for research/data/writing tasks.',
        'Agent-assisted sourcing + drafting reduces time-to-first-proposal.',
      ],
      risks: [
        'Platform fees and competition compress margins.',
        'Operator must actually be able to deliver the work.',
      ],
      integrityBasis:
        'Proposals are truthful about who does the work and the use of AI assistance; no fake ' +
        'portfolios, no plagiarized samples, no bidding on work that can\'t be delivered.',
    },
  ];
}

/**
 * Optionally extend the catalog with Claude-researched ideas. Returns the vetted
 * catalog unchanged if no key is configured or the call fails — the catalog is
 * always the trustworthy floor. (Implementation left as a thin, safe stub:
 * wiring a live model in must keep the same Opportunity shape and re-score +
 * re-assess every result.)
 */
export async function scoutWithClaude(
  apiKey: string,
  _model: string,
): Promise<Opportunity[]> {
  const base = vettedCatalog();
  if (!apiKey) return base;
  // Live LLM extension is intentionally not auto-enabled: any model-suggested
  // opportunity must be reviewed by a human before it is trusted, so we keep the
  // deterministic catalog as the default and document how to extend it in README.
  return base;
}
