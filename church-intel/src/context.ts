import { AnthropicProvider } from './claude/client.js';
import { SupabaseStore } from './db/supabase.js';
import { ResilientResearch } from './research/resilient.js';
import type { AgentContext } from './agents/index.js';
import type { Store } from './db/store.js';

export interface LiveContext extends AgentContext {
  store: Store;
  close(): Promise<void>;
}

export interface LiveContextOptions {
  /** Force the plain-HTTP fetch crawler instead of Playwright. */
  forceFetch?: boolean;
}

/** Build the production context: Supabase + Claude + resilient research. */
export function createLiveContext(opts: LiveContextOptions = {}): LiveContext {
  const store = new SupabaseStore();
  const llm = new AnthropicProvider();
  const research = new ResilientResearch({ forceFetch: opts.forceFetch });
  return {
    store,
    llm,
    research,
    close: async () => {
      await research.close();
    },
  };
}
