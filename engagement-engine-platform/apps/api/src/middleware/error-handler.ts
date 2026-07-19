import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppVariables } from '../types.js';
import { AppError } from '@ee/domain';

export function errorHandler(err: Error, c: Context<{ Variables: AppVariables }>) {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as ContentfulStatusCode);
  }

  console.error('[api] unhandled error', err);
  return c.json(
    { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    500 as ContentfulStatusCode,
  );
}
