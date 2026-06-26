import { buildDossier, type ResearchTarget } from '../research/researchAgent.js';
import { AnthropicProvider } from '../claude/client.js';
import { ResilientResearch } from '../research/resilient.js';
import { prospectArea, type KnownChurch } from '../research/prospect.js';
import { googlePlacesProvider, searchDirectoryProvider } from '../research/prospectProviders.js';
import { mapDossierBuild } from './mapper.js';
import { config } from '../config.js';
import type { ChurchResearchFields, DossierSections, JobStage } from './contract.js';

/**
 * PipelineRunner — the seam between the API and the existing research agent. The
 * real runner reuses `buildDossier` / `prospectArea` UNCHANGED; tests inject a
 * mock so the API can be exercised without Claude/Supabase/Chromium/network.
 *
 * `onStage` lets the runner advance the job's stage+progress as the pipeline
 * moves; the API persists each update so Base44's polling sees live state.
 */
export type StageEmitter = (stage: JobStage, progress: number) => void | Promise<void>;

export interface KnownChurchInput {
  name: string;
  city?: string | null;
  state?: string | null;
  url?: string | null;
}
export interface DiscoveryFilters {
  unknown_only?: boolean;
  min_awa?: number | null;
  multi_campus_only?: boolean;
}
export interface DiscoveryInput {
  metro: string;
  state?: string | null;
  limit?: number;
  filters?: DiscoveryFilters;
}

export interface KnownChurchOutput {
  church: ChurchResearchFields;
  sections: DossierSections;
}
export interface DiscoveryOutput {
  churches: ChurchResearchFields[];
  board: unknown;
}

export interface PipelineRunner {
  runKnownChurch(input: KnownChurchInput, onStage: StageEmitter): Promise<KnownChurchOutput>;
  runDiscovery(input: DiscoveryInput, onStage: StageEmitter): Promise<DiscoveryOutput>;
}

export interface RealPipelineRunnerOptions {
  /** Known roster for dedup (unknown-only discovery). Wired to the CIP repository. */
  knownRoster?: () => Promise<KnownChurch[]>;
}

/** Production runner — real Anthropic + resilient crawler + the existing agent. */
export class RealPipelineRunner implements PipelineRunner {
  private knownRoster: () => Promise<KnownChurch[]>;
  constructor(opts: RealPipelineRunnerOptions = {}) {
    this.knownRoster = opts.knownRoster ?? (async () => []);
  }

  async runKnownChurch(input: KnownChurchInput, onStage: StageEmitter): Promise<KnownChurchOutput> {
    const llm = new AnthropicProvider();
    const research = new ResilientResearch();
    try {
      await onStage('discovery', 10);
      const target: ResearchTarget = {
        name: input.name, city: input.city ?? null, state: input.state ?? null,
        originalWebsite: input.url ?? null, alternateName: null, mode: 'known_church',
      };
      await onStage('extraction', 35);
      const build = await buildDossier(target, { llm, research });
      await onStage('coverage_validation', 70);
      await onStage('scoring', 85);
      const mapped = mapDossierBuild(target, build);
      await onStage('dossier_generation', 95);
      return mapped;
    } finally {
      await research.close();
    }
  }

  async runDiscovery(input: DiscoveryInput, onStage: StageEmitter): Promise<DiscoveryOutput> {
    const llm = new AnthropicProvider();
    const research = new ResilientResearch();
    try {
      await onStage('discovery', 15);
      const board = await prospectArea(
        { metro: input.metro, state: input.state ?? null, limit: input.limit },
        {
          enumerators: [googlePlacesProvider(), searchDirectoryProvider()],
          knownRoster: this.knownRoster,
          buildDossier: (t) => buildDossier(t, { llm, research }),
          limit: input.limit ?? config.prospect.maxDossiers,
        },
      );
      await onStage('scoring', 80);
      const f = input.filters ?? {};
      let entries = board.entries;
      if (f.unknown_only) entries = entries.filter((e) => !e.known);
      if (typeof f.min_awa === 'number') entries = entries.filter((e) => (e.attendance ?? 0) >= f.min_awa!);
      if (f.multi_campus_only) entries = entries.filter((e) => /multi/i.test(e.archetype));
      const churches: ChurchResearchFields[] = entries.map((e) => ({
        name: e.name, city: e.city, state: e.state, website: e.website, verified: false,
        denomination: null, archetype: e.archetype, lifecycle: null, awa: e.attendance,
        attendance_source: null, coverage_percent: null, research_confidence: null,
        engagement_fit: e.fit, priority: e.priority,
      }));
      await onStage('dossier_generation', 95);
      return { churches, board: { ...board, entries } };
    } finally {
      await research.close();
    }
  }
}
