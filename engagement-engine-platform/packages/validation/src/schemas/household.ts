import { z } from 'zod';

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(255),
  primaryCampusId: z.string().uuid().optional(),
});
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdSchema>;

export const AddHouseholdMemberSchema = z.object({
  personId: z.string().uuid(),
  relationshipType: z.string().min(1).max(100),
  isPrimaryContact: z.boolean().default(false),
});
export type AddHouseholdMemberInput = z.infer<typeof AddHouseholdMemberSchema>;
