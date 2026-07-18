import type { Context, Next } from 'hono';
import type { AppVariables } from '../types.js';

type AppContext = Context<{ Variables: AppVariables }>;
import { AuthenticationRequiredError } from '@ee/domain';

export async function requireAuth(c: AppContext, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationRequiredError();
  }

  const token = authHeader.slice(7);
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase environment variables not configured');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: ['Bearer', token].join(' ') } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) {
    throw new AuthenticationRequiredError();
  }

  c.set('user', user);
  c.set('supabaseClient', client);
  await next();
}
