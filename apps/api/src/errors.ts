/**
 * Every error leaves the API as `{ "error": { "code", "message", "details"? } }`.
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "bad_request"
  | "invalid_json"
  | "validation_failed"
  | "unauthorized"
  | "invalid_credentials"
  | "forbidden"
  | "email_not_verified"
  | "not_found"
  | "conflict"
  | "email_taken"
  | "duplicate"
  | "precondition_required"
  | "payload_too_large"
  | "unsupported_media_type"
  | "quota_exceeded"
  | "invalid_flow"
  | "lint_failed"
  | "invalid_token"
  | "rate_limited"
  | "provider_not_allowed"
  | "upstream_error"
  | "upstream_timeout"
  | "service_unavailable"
  | "internal_error";

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } };
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details),
  validation: (details: unknown) => new ApiError(400, "validation_failed", "Request validation failed", details),
  unauthorized: (message = "Authentication required") => new ApiError(401, "unauthorized", message, undefined, { "WWW-Authenticate": 'Bearer realm="autoflow"' }),
  forbidden: (message = "Not allowed") => new ApiError(403, "forbidden", message),
  notFound: (what = "Resource") => new ApiError(404, "not_found", `${what} not found`),
  conflict: (message: string, details?: unknown) => new ApiError(409, "conflict", message, details),
  tooLarge: (message = "Payload too large") => new ApiError(413, "payload_too_large", message),
  rateLimited: (retryAfterMs: number) =>
    new ApiError(429, "rate_limited", "Too many requests, slow down", { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }),
};
