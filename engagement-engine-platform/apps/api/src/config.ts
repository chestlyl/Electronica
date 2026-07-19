/**
 * Centralized API server configuration.
 *
 * This module exports a lazy config getter that validates all required server
 * environment variables on first access. It also exports the single
 * service-role Supabase client factory that all domain services must use.
 *
 * Route handlers MUST NOT read process.env['SUPABASE_SERVICE_ROLE_KEY']
 * directly. Instead they call createServiceClient() from this module.
 *
 * On application startup (index.ts) we call getConfig() explicitly so that
 * missing environment variables fail fast before the server begins accepting
 * requests. In tests the config is never accessed unless a test explicitly
 * imports a service that calls createServiceClient(), making health tests
 * continue to work without server env vars.
 */
import { validateServerEnv, validatePublicEnv } from '@ee/configuration';
import { createServerClient } from '@ee/database';
import type { ServerEnv } from '@ee/configuration';

interface Config {
  nodeEnv: ServerEnv['NODE_ENV'];
  logLevel: ServerEnv['LOG_LEVEL'];
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  corsAllowedOrigins: string[];
  isProduction: boolean;
}

let _config: Config | undefined;

export function getConfig(): Config {
  if (!_config) {
    const serverEnv = validateServerEnv();
    const publicEnv = validatePublicEnv();
    _config = {
      nodeEnv: serverEnv.NODE_ENV,
      logLevel: serverEnv.LOG_LEVEL,
      apiUrl: serverEnv.API_URL,
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      corsAllowedOrigins: serverEnv.CORS_ALLOWED_ORIGINS.split(',')
        .map((o: string) => o.trim())
        .filter(Boolean),
      isProduction: serverEnv.NODE_ENV === 'production',
    };
  }
  return _config;
}

/**
 * Returns a Supabase service-role client using the validated configuration.
 * The service-role key bypasses RLS — callers are responsible for
 * ensuring the operation has been authorized before calling this.
 */
export function createServiceClient() {
  const cfg = getConfig();
  return createServerClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
}

// Convenience re-export for use in app.ts CORS setup.
// Accessing config here is safe because app.ts is only imported after
// index.ts calls getConfig() at startup.
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof Config];
  },
});
