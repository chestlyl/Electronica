import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  DATABASE_URL: z.string().url(),
  API_URL: z.string().url().default('http://localhost:4000'),
  API_SECRET: z.string().min(1),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function validateServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`[configuration] Missing or invalid server environment variables: ${missing}`);
  }
  return result.data;
}

export function validatePublicEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): PublicEnv {
  const result = publicEnvSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`[configuration] Missing or invalid public environment variables: ${missing}`);
  }
  return result.data;
}
