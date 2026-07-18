import { z } from 'zod';

export const AssignRoleSchema = z.object({
  membershipId: z.string().uuid(),
  roleId: z.string().uuid(),
  campusId: z.string().uuid().optional(),
  ministryId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
});
export type AssignRoleInput = z.infer<typeof AssignRoleSchema>;
