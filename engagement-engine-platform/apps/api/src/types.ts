import type { User, SupabaseClient } from '@supabase/supabase-js';

export type AppVariables = {
  user: User;
  supabaseClient: SupabaseClient;
  membership: { id: string; status: string };
  requestId: string;
};
