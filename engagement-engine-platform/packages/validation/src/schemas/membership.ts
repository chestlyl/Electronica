import { z } from 'zod';

export const MembershipStatusSchema = z.enum(['invited', 'active', 'suspended', 'removed']);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
  campusId: z.string().uuid().optional(),
  ministryId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
