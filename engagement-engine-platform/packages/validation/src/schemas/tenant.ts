import { z } from 'zod';

export const TenantStatusSchema = z.enum(['pilot', 'trial', 'active', 'suspended', 'archived']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  timezone: z.string().default('America/New_York'),
  defaultCurrency: z.string().length(3).default('USD'),
  status: TenantStatusSchema.default('pilot'),
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const UpdateTenantSchema = CreateTenantSchema.partial().omit({ slug: true });
export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>;
