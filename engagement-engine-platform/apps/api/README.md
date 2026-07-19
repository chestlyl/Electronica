# @ee/api

The central privileged API server for the Engagement Engine. Used by web clients, mobile clients, workers, integrations, and the future AI assistant.

All business logic routes through this service. The Supabase service-role key is only held here — never in browser applications.

## Layer 1 endpoints

| Method | Path                                | Description                       |
| ------ | ----------------------------------- | --------------------------------- |
| GET    | /health                             | Service health check              |
| GET    | /api/me                             | Authenticated current user        |
| GET    | /api/me/permissions/:tenantId       | Effective permissions             |
| GET    | /api/tenants/:tenantId              | Tenant info (membership required) |
| GET    | /api/tenants/:tenantId/people       | List people                       |
| POST   | /api/tenants/:tenantId/people       | Create person                     |
| GET    | /api/tenants/:tenantId/households   | List households                   |
| POST   | /api/tenants/:tenantId/households   | Create household                  |
| POST   | /api/tenants/:tenantId/roles/assign | Assign role                       |
| POST   | /api/tenants/:tenantId/invitations  | Create invitation                 |
| GET    | /api/tenants/:tenantId/audit        | View audit events                 |
