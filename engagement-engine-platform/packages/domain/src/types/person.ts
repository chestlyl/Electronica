export interface UserProfile {
  userId: string;
  displayName: string | null;
  preferredName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  tenantId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'archived';
  primaryCampusId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Household {
  id: string;
  tenantId: string;
  name: string;
  primaryCampusId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface HouseholdMember {
  id: string;
  tenantId: string;
  householdId: string;
  personId: string;
  relationshipType: string;
  isPrimaryContact: boolean;
  createdAt: string;
  updatedAt: string;
}
