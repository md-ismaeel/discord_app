// import { ApiErrorType } from "../types/apiError";

// export const createApiError = (
//   statusCode: number,
//   message: string,
//   errors: any = null,
// ): ApiErrorType => {
//   const error = new Error(message) as ApiErrorType;

//   error.statusCode = statusCode;
//   error.errors = errors;
//   error.success = false;

//   return error;
// };


// ─── ApiError
// A throw-able class that carries an HTTP status code and optional validation
// details. Extends native Error so instanceof checks work correctly.

export class ApiError extends Error {
  readonly statusCode: number;
  readonly success = false as const;
  readonly errors?: unknown;

  constructor(statusCode: number, message: string, errors?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // ── Static factory helpers
  static badRequest(message: string, errors?: unknown): ApiError {
    return new ApiError(400, message, errors);
  }

  static unauthorized(
    message = "Authentication required. Please log in.",
  ): ApiError {
    return new ApiError(401, message);
  }

  static forbidden(
    message = "You do not have permission to perform this action.",
  ): ApiError {
    return new ApiError(403, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static tooManyRequests(
    message = "Too many requests. Please slow down.",
  ): ApiError {
    return new ApiError(429, message);
  }

  static internal(
    message = "Something went wrong. Please try again later.",
  ): ApiError {
    return new ApiError(500, message);
  }
}

// ─── Type guard
export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

// ─── Backward-compat alias
// Several files still import createApiError(statusCode, message, errors).
// This shim keeps those call-sites working while the class is the real implementation.

export const createApiError = (
  statusCode: number,
  message: string,
  errors?: unknown,
): ApiError => new ApiError(statusCode, message, errors);