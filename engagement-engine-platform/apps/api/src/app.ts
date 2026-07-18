import { Hono } from 'hono';
import type { AppVariables } from './types.js';
import { cors } from 'hono/cors';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { tenantsRouter } from './routes/tenants.js';
import { peopleRouter } from './routes/people.js';
import { householdsRouter } from './routes/households.js';
import { rolesRouter } from './routes/roles.js';
import { invitationsRouter } from './routes/invitations.js';
import { auditRouter } from './routes/audit.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { getConfig } from './config.js';

export const app = new Hono<{ Variables: AppVariables }>();

// Security and correlation headers on every request
app.use('*', requestIdMiddleware);
app.use('*', securityHeadersMiddleware);

// CORS — only allow explicitly configured origins (never wildcard in production)
// getConfig() is called lazily here so the health test can import app without
// requiring server env vars.
app.use('*', async (c, next) => {
  const cfg = getConfig();
  return cors({
    origin: cfg.corsAllowedOrigins,
    credentials: true,
  })(c, next);
});

app.route('/health', healthRouter);
app.route('/api/me', meRouter);
app.route('/api/tenants', tenantsRouter);
app.route('/api/tenants', peopleRouter);
app.route('/api/tenants', householdsRouter);
app.route('/api/tenants', rolesRouter);
app.route('/api/tenants', invitationsRouter);
app.route('/api/tenants', auditRouter);
// Invitation acceptance is tenant-agnostic (the token determines the tenant)
app.route('/api', invitationsRouter);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError(errorHandler);

export default app;
