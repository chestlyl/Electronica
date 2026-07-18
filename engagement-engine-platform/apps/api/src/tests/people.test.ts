/**
 * Unit tests for the people domain service.
 * These tests mock the Supabase client to isolate service logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock the config module so createServiceClient() doesn't try to connect
vi.mock('../config.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseServiceRoleKey: 'test-key',
    corsAllowedOrigins: ['http://localhost:3000'],
    nodeEnv: 'test',
    isProduction: false,
  }),
  createServiceClient: vi.fn(),
}));

// Mock the audit service so it doesn't fail when no real DB is available
vi.mock('../services/audit.service.js', () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock hasPermission from @ee/permissions
vi.mock('@ee/permissions', () => ({
  hasPermission: vi.fn(),
}));

import { hasPermission } from '@ee/permissions';
import { createServiceClient } from '../config.js';
import { listPeople, createPerson } from '../services/people.service.js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';

const mockDb = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null }),
} as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPeople', () => {
  it('throws PermissionDeniedError when user lacks people.view', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);

    await expect(
      listPeople({ db: mockDb, userId: 'user-1', tenantId: 'tenant-1' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('returns people array when user has people.view', async () => {
    const fakePeople = [{ id: 'p1', first_name: 'James', last_name: 'Whitfield' }];
    vi.mocked(hasPermission).mockResolvedValueOnce(true);

    const dbWithData = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: fakePeople, error: null }),
    } as unknown as SupabaseClient;

    const result = await listPeople({ db: dbWithData, userId: 'user-1', tenantId: 'tenant-1' });
    expect(result).toEqual(fakePeople);
  });

  it('ordinary member (no people.view) cannot list people — verifies member role restriction', async () => {
    // A member only has member.self_access — hasPermission('people.view') returns false
    vi.mocked(hasPermission).mockResolvedValueOnce(false);

    await expect(
      listPeople({ db: mockDb, userId: 'member-user-id', tenantId: 'tenant-1' }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('createPerson', () => {
  const validBody = {
    firstName: 'Alice',
    lastName: 'Test',
    status: 'active',
    primaryCampusId: 'cc111111-1111-1111-1111-111111111111',
  };

  it('throws ValidationFailedError for invalid input', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await expect(
      createPerson({ db: mockDb, userId: 'user-1', tenantId: 'tenant-1' }, { invalid: true }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('throws PermissionDeniedError when user lacks people.create (tenant-wide and campus-scoped)', async () => {
    // Both tenant-wide and campus-scoped permission checks fail
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      createPerson({ db: mockDb, userId: 'user-1', tenantId: 'tenant-1' }, validBody),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('creates person when user has tenant-wide people.create', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true); // tenant-wide passes

    const insertedPerson = { id: 'new-person-id', ...validBody };
    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: insertedPerson, error: null }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    const result = await createPerson(
      { db: mockDb, userId: 'admin-user', tenantId: 'tenant-1' },
      validBody,
    );
    expect(result).toEqual(insertedPerson);
  });

  it('creates person when user has campus-scoped people.create and provides matching campus', async () => {
    vi.mocked(hasPermission)
      .mockResolvedValueOnce(false) // tenant-wide fails
      .mockResolvedValueOnce(true); // campus-scoped passes

    const insertedPerson = { id: 'new-person-id', ...validBody };
    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: insertedPerson, error: null }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    const result = await createPerson(
      { db: mockDb, userId: 'campus-admin', tenantId: 'tenant-1' },
      validBody,
    );
    expect(result).toEqual(insertedPerson);
  });

  it('ordinary member cannot create a person', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await expect(
      createPerson({ db: mockDb, userId: 'member-id', tenantId: 'tenant-1' }, validBody),
    ).rejects.toThrow(PermissionDeniedError);
  });
});
