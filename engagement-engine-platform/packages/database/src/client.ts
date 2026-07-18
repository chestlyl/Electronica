import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-side client using service role (trusted, never expose to browser)
export function createServerClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Client-side client using anon key (safe for browsers)
export function createBrowserClient(supabaseUrl: string, anonKey: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey);
}

// Server-side client acting as an authenticated user (via JWT)
export function createUserClient(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: ['Bearer', accessToken].join(' '),
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
