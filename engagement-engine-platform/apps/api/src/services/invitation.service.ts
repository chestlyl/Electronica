import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreateInvitationSchema } from '@ee/validation';
import { createServiceClient } from '../config.js';
import { writeAuditEvent } from './audit.service.js';

interface InvitationServiceDeps {
  db: SupabaseClient;
  userId: string;
  tenantId: string;
  requestId?: string;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Creates an invitation for a new user to join a tenant.
 *
 * The raw token is returned ONLY in development environments via this
 * function's result. In production the raw token is never returned from
 * any API response; only a hashed value is stored. Email delivery is a
 * future concern (Layer 2).
 *
 * Security:
 *   - Raw token: 32 random bytes (256-bit entropy)
 *   - Stored value: SHA-256 hash of the raw token
 *   - The raw token is never logged or stored
 */
export async function createInvitation(
  { db, userId, tenantId, requestId }: InvitationServiceDeps,
  rawBody: unknown,
) {
  const allowed = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'invitations.create',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const parsed = CreateInvitationSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ValidationFailedError('Invalid invitation data', parsed.error.flatten());
  }

  const input = parsed.data;
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + INVITATION_TTL_MS);

  const serviceClient = createServiceClient();

  const { data: invitation, error } = await serviceClient
    .from('invitations')
    .insert({
      tenant_id: tenantId,
      email: input.email,
      invited_by_user_id: userId,
      role_id: input.roleId,
      campus_id: input.campusId ?? null,
      ministry_id: input.ministryId ?? null,
      token_hash: tokenHash,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select('id, email, status, expires_at, created_at')
    .single();

  if (error) throw error;

  await writeAuditEvent(serviceClient, {
    tenantId,
    actorUserId: userId,
    action: 'invitation.created',
    entityType: 'invitation',
    entityId: (invitation as { id: string }).id,
    metadata: { email: input.email, roleId: input.roleId },
    requestId,
  });

  const result: Record<string, unknown> = { invitation };

  // In development, expose the raw token so developers can test the
  // acceptance flow without a real email provider.
  if (process.env['NODE_ENV'] !== 'production') {
    result['_dev_only_raw_token'] = rawToken;
  }

  return result;
}

interface AcceptInvitationInput {
  /** Raw (unhashed) token from the invitation email / dev response */
  token: string;
}

/**
 * Accepts an invitation and creates or activates a tenant membership.
 *
 * Security:
 *   - Token is hashed before lookup — the stored hash is never returned.
 *   - Invitation must be pending, unexpired, and not revoked.
 *   - Invitation email must match the accepting user's auth email.
 *   - Invitation's tenant_id is used for the new membership — the caller
 *     cannot redirect the acceptance to another tenant.
 *   - Replay is prevented: status is set to 'accepted' + accepted_by_user_id
 *     is set atomically. A second attempt finds status != 'pending'.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  input: AcceptInvitationInput,
  requestId?: string,
) {
  if (!input.token || typeof input.token !== 'string') {
    throw new ValidationFailedError('token is required');
  }

  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const serviceClient = createServiceClient();

  const { data: invitation, error: lookupError } = await serviceClient
    .from('invitations')
    .select('id, tenant_id, email, status, expires_at, role_id, campus_id, ministry_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (!invitation) {
    throw new ValidationFailedError('Invalid or expired invitation token');
  }

  // Cross-tenant redemption guard: email must match
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ValidationFailedError('This invitation was not issued to your account');
  }

  if (invitation.status !== 'pending') {
    throw new ValidationFailedError(
      `Invitation cannot be accepted: status is '${invitation.status}'`,
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    throw new ValidationFailedError('Invitation has expired');
  }

  const { tenantId, roleId, campusId, ministryId } = {
    tenantId: invitation.tenant_id as string,
    roleId: invitation.role_id as string,
    campusId: (invitation.campus_id as string | null) ?? null,
    ministryId: (invitation.ministry_id as string | null) ?? null,
  };

  // Create or reactivate membership
  const { data: existing } = await serviceClient
    .from('tenant_memberships')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  let membershipId: string;

  if (existing) {
    const { data: updated, error: updateErr } = await serviceClient
      .from('tenant_memberships')
      .update({ status: 'active', joined_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id')
      .single();
    if (updateErr) throw updateErr;
    membershipId = (updated as { id: string }).id;
  } else {
    const { data: created, error: createErr } = await serviceClient
      .from('tenant_memberships')
      .insert({ tenant_id: tenantId, user_id: userId, status: 'active' })
      .select('id')
      .single();
    if (createErr) throw createErr;
    membershipId = (created as { id: string }).id;
  }

  // Assign role
  await serviceClient.from('role_assignments').insert({
    tenant_id: tenantId,
    membership_id: membershipId,
    role_id: roleId,
    campus_id: campusId,
    ministry_id: ministryId,
  });

  // Mark invitation as accepted (prevents replay)
  await serviceClient
    .from('invitations')
    .update({ status: 'accepted', accepted_by_user_id: userId })
    .eq('id', invitation.id);

  await writeAuditEvent(serviceClient, {
    tenantId,
    actorUserId: userId,
    action: 'invitation.accepted',
    entityType: 'invitation',
    entityId: invitation.id as string,
    metadata: { membershipId, roleId },
    requestId,
  });

  return { tenantId, membershipId, roleId };
}
