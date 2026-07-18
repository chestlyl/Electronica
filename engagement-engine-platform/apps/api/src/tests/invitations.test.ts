/**
 * Unit tests for the invitation domain service.
 * Tests the full invitation lifecycle including security properties.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';

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

vi.mock('../services/audit.service.js', () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ee/permissions', () => ({
  hasPermission: vi.fn(),
}));

import { hasPermission } from '@ee/permissions';
import { createServiceClient } from '../config.js';
import { createInvitation, acceptInvitation } from '../services/invitation.service.js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createInvitation', () => {
  const mockDb = {} as Parameters<typeof createInvitation>[0]['db'];
  const validBody = {
    email: 'new.member@example.invalid',
    roleId: '00000000-0000-0000-0000-000000000001',
  };

  it('throws PermissionDeniedError when user lacks invitations.create', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    await expect(
      createInvitation({ db: mockDb, userId: 'user-1', tenantId: 'tenant-1' }, validBody),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('throws ValidationFailedError for missing email', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    await expect(
      createInvitation({ db: mockDb, userId: 'user-1', tenantId: 'tenant-1' }, { roleId: 'r1' }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('stores a token hash, not the raw token', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);

    let storedHash: string | undefined;
    const invitationId = 'inv-001';
    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        storedHash = data['token_hash'] as string;
        return serviceClientMock;
      }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: invitationId, email: validBody.email, status: 'pending', expires_at: new Date().toISOString(), created_at: new Date().toISOString() },
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    const result = await createInvitation(
      { db: mockDb, userId: 'admin', tenantId: 'tenant-1' },
      validBody,
    );

    // The stored hash must not be the raw token
    const rawToken = (result as Record<string, unknown>)['_dev_only_raw_token'] as string;
    expect(rawToken).toBeTruthy();
    expect(storedHash).toBeTruthy();
    expect(storedHash).not.toEqual(rawToken);

    // The stored value must be the SHA-256 hash of the raw token
    const expectedHash = createHash('sha256').update(rawToken).digest('hex');
    expect(storedHash).toEqual(expectedHash);
  });

  it('does not expose raw token in production', async () => {
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    vi.mocked(hasPermission).mockResolvedValueOnce(true);

    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'inv-002', email: validBody.email, status: 'pending', expires_at: new Date().toISOString(), created_at: new Date().toISOString() },
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    const result = await createInvitation(
      { db: mockDb, userId: 'admin', tenantId: 'tenant-1' },
      validBody,
    );

    expect((result as Record<string, unknown>)['_dev_only_raw_token']).toBeUndefined();
    process.env['NODE_ENV'] = originalEnv;
  });
});

describe('acceptInvitation', () => {
  it('throws ValidationFailedError for missing token', async () => {
    await expect(
      acceptInvitation('user-1', 'user@example.invalid', { token: '' }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('rejects an invalid (not found) token', async () => {
    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    await expect(
      acceptInvitation('user-1', 'user@example.invalid', { token: 'bad-token' }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('rejects an invitation for a different email (cross-tenant guard)', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const futureDate = new Date(Date.now() + 86400_000).toISOString();

    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          email: 'other.person@example.invalid',
          status: 'pending',
          expires_at: futureDate,
          role_id: 'role-1',
          campus_id: null,
          ministry_id: null,
        },
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    await expect(
      acceptInvitation('user-1', 'attacker@example.invalid', { token: rawToken }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('rejects an already-accepted invitation (replay prevention)', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const futureDate = new Date(Date.now() + 86400_000).toISOString();

    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          email: 'user@example.invalid',
          status: 'accepted',  // already accepted
          expires_at: futureDate,
          role_id: 'role-1',
          campus_id: null,
          ministry_id: null,
        },
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    await expect(
      acceptInvitation('user-1', 'user@example.invalid', { token: rawToken }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('rejects an expired invitation', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const pastDate = new Date(Date.now() - 86400_000).toISOString();

    const serviceClientMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          email: 'user@example.invalid',
          status: 'pending',
          expires_at: pastDate,  // expired
          role_id: 'role-1',
          campus_id: null,
          ministry_id: null,
        },
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    await expect(
      acceptInvitation('user-1', 'user@example.invalid', { token: rawToken }),
    ).rejects.toThrow(ValidationFailedError);
  });

  it('accepts a valid invitation and creates membership + role assignment', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const futureDate = new Date(Date.now() + 86400_000).toISOString();
    const membershipId = 'new-membership-id';

    const invitationData = {
      id: 'inv-valid',
      tenant_id: 'tenant-1',
      email: 'new.member@example.invalid',
      status: 'pending',
      expires_at: futureDate,
      role_id: 'member-role',
      campus_id: null,
      ministry_id: null,
    };

    // Track which methods were called
    const insertCalls: string[] = [];
    const updateCalls: string[] = [];

    const serviceClientMock = {
      from: vi.fn((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: table === 'invitations' ? invitationData : null,
            error: null,
          }),
          insert: vi.fn((data: Record<string, unknown>) => {
            insertCalls.push(table);
            if (table === 'tenant_memberships') {
              return { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: membershipId }, error: null }) };
            }
            return { error: null };
          }),
          update: vi.fn((data: Record<string, unknown>) => {
            updateCalls.push(table);
            return { eq: vi.fn().mockReturnThis() };
          }),
          single: vi.fn().mockResolvedValue({ data: { id: membershipId }, error: null }),
        };
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(serviceClientMock as unknown as ReturnType<typeof createServiceClient>);

    const result = await acceptInvitation(
      'user-1',
      'new.member@example.invalid',
      { token: rawToken },
    );

    expect(result.tenantId).toBe('tenant-1');
    expect(result.roleId).toBe('member-role');
    // Invitation should have been updated to 'accepted'
    expect(updateCalls).toContain('invitations');
  });
});
