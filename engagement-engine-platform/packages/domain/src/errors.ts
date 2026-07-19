export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthenticationRequiredError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'AUTHENTICATION_REQUIRED', 401);
  }
}

export class TenantMembershipRequiredError extends AppError {
  constructor(message = 'Tenant membership required') {
    super(message, 'TENANT_MEMBERSHIP_REQUIRED', 403);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, 'PERMISSION_DENIED', 403);
  }
}

export class ScopeDeniedError extends AppError {
  constructor(message = 'Access denied for this campus or ministry scope') {
    super(message, 'SCOPE_DENIED', 403);
  }
}

export class ValidationFailedError extends AppError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, 'VALIDATION_FAILED', 400);
  }
}

export class RecordNotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} not found: ${id}` : `${entity} not found`, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}

export class DuplicateError extends AppError {
  constructor(message: string) {
    super(message, 'DUPLICATE', 409);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 'INTERNAL_ERROR', 500);
  }
}
