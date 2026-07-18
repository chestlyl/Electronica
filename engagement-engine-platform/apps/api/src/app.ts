import { Hono } from 'hono';
import type { AppVariables } from './types.js';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { tenantsRouter } from './routes/tenants.js';
import { peopleRouter } from './routes/people.js';
import { householdsRouter } from './routes/households.js';
import { rolesRouter } from './routes/roles.js';
import { invitationsRouter } from './routes/invitations.js';
import { auditRouter } from './routes/audit.js';
import { errorHandler } from './middleware/error-handler.js';

export const app = new Hono<{ Variables: AppVariables }>();

app.use('*', logger());
app.use('*', cors());

app.route('/health', healthRouter);
app.route('/api/me', meRouter);
app.route('/api/tenants', tenantsRouter);
app.route('/api/tenants', peopleRouter);
app.route('/api/tenants', householdsRouter);
app.route('/api/tenants', rolesRouter);
app.route('/api/tenants', invitationsRouter);
app.route('/api/tenants', auditRouter);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError(errorHandler);

export default app;
