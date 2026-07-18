export interface Campus {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  timezone: string | null;
  status: 'active' | 'inactive' | 'archived';
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Ministry {
  id: string;
  tenantId: string;
  campusId: string | null;
  name: string;
  slug: string;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
