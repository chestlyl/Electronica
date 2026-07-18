import type { Context, Next } from 'hono';

interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Human-readable label for error messages. */
  label?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * NOTE: This implementation is suitable for single-process development and
 * staging environments only. Production deployments that run multiple API
 * instances MUST replace this with a distributed limiter backed by Redis or
 * a similar shared store. The interface is kept simple so it can be swapped
 * without changing call sites.
 *
 * Key is derived from the authenticated user ID when available, otherwise
 * from the client IP address supplied by the runtime.
 */
export function rateLimiter(options: RateLimitOptions) {
  const store = new Map<string, WindowEntry>();

  return async function rateLimit(c: Context, next: Next) {
    const userId: string | undefined = (c.get('user') as { id?: string } | undefined)?.id;
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    const key = userId ? `user:${userId}` : `ip:${ip}`;

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      entry.count += 1;
      if (entry.count > options.limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header('Retry-After', String(retryAfter));
        return c.json(
          { error: `Too many requests${options.label ? ` (${options.label})` : ''}` },
          429,
        );
      }
    }

    await next();
  };
}
