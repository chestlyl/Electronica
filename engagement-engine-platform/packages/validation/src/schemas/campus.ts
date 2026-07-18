import { z } from 'zod';

export const CampusStatusSchema = z.enum(['active', 'inactive', 'archived']);
export type CampusStatus = z.infer<typeof CampusStatusSchema>;

export const CreateCampusSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  timezone: z.string().optional(),
  status: CampusStatusSchema.default('active'),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(255).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).default('US'),
});
export type CreateCampusInput = z.infer<typeof CreateCampusSchema>;
