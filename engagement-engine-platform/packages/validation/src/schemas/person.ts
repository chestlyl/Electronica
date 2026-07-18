import { z } from 'zod';

export const PersonStatusSchema = z.enum(['active', 'inactive', 'archived']);
export type PersonStatus = z.infer<typeof PersonStatusSchema>;

export const CreatePersonSchema = z.object({
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  preferredName: z.string().max(255).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  status: PersonStatusSchema.default('active'),
  primaryCampusId: z.string().uuid().optional(),
});
export type CreatePersonInput = z.infer<typeof CreatePersonSchema>;

export const UpdatePersonSchema = CreatePersonSchema.partial();
export type UpdatePersonInput = z.infer<typeof UpdatePersonSchema>;
