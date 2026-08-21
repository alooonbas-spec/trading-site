export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    options: {
      code: string;
      status?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.status = options.status ?? 400;
    this.details = options.details;
  }
}

export class SocialError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: "SOCIAL_ERROR", status: 502, details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, { code: "UNAUTHENTICATED", status: 401 });
  }
}

export class PermissionError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, { code: "FORBIDDEN", status: 403 });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Rate limit reached", details?: Record<string, unknown>) {
    super(message, { code: "RATE_LIMITED", status: 429, details });
  }
}

export class UnsupportedActionError extends AppError {
  constructor(message = "This action is not supported") {
    super(message, { code: "UNSUPPORTED_ACTION", status: 422 });
  }
}

export class NetworkError extends AppError {
  constructor(message = "Network request failed") {
    super(message, { code: "NETWORK_ERROR", status: 503 });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: "VALIDATION_ERROR", status: 400, details });
  }
}

export class DoNotContactError extends AppError {
  constructor(message = "This lead is marked do_not_contact") {
    super(message, { code: "DO_NOT_CONTACT", status: 403 });
  }
}

export class SocialAccountUnavailableError extends AppError {
  constructor(message = "Social account is not available for this operation") {
    super(message, { code: "SOCIAL_ACCOUNT_UNAVAILABLE", status: 409 });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function errorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (isAppError(error)) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return fallback;
}
