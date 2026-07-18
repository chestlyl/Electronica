import type { Context, Next } from 'hono';

/**
 * Adds conservative security response headers to every request.
 */
export async function securityHeadersMiddleware(c: Context, next: Next) {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Only send HSTS over HTTPS. In production NODE_ENV is 'production'.
  if (process.env['NODE_ENV'] === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
