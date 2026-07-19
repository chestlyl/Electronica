import { randomUUID } from 'crypto';
import type { Context, Next } from 'hono';

const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Middleware that ensures every request has a correlation ID.
 * Accepts a valid incoming X-Request-ID header or generates a new UUID.
 * Adds the ID to the response headers and stores it as the 'requestId'
 * context variable so route handlers and domain services can include it
 * in audit events and structured logs.
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = incoming && /^[\w\-]{1,128}$/.test(incoming) ? incoming : randomUUID();

  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  await next();
}
