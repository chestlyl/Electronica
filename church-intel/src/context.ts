import { AnthropicProvider } from './claude/client.js';
import { SupabaseStore } from './db/supabase.js';
import { PlaywrightResearch } from './research/browser.js';
import type { AgentContext } from './agents/index.js';
import type { Store } from './db/store.js';

export interface LiveContext extends AgentContext {
  store: Store;
  close(): Promise<void>;
}

/** Build the production context: Supabase + Claude + Playwright. */
export function createLiveContext(): LiveContext {
  const store = new SupabaseStore();
  const llm = new AnthropicProvider();
  const research = new PlaywrightResearch();
  return {
    store,
    llm,
    research,
    close: async () => {
      await research.close();
    },
  };
}
