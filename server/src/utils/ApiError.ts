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

import { HTTP_STATUS } from "@/constants/httpStatus";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly success = false as const;
  readonly errors?: unknown;

  constructor(statusCode: number, message: string, errors?: unknown) {
    super(message)
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
    return new ApiError(HTTP_STATUS.BAD_REQUEST, message, errors);
  }

  static unauthorized(
    message = "Authentication required. Please log in.",
  ): ApiError {
    return new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
  }

  static forbidden(
    message = "You do not have permission to perform this action.",
  ): ApiError {
    return new ApiError(HTTP_STATUS.FORBIDDEN, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(HTTP_STATUS.NOT_FOUND, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(HTTP_STATUS.CONFLICT, message);
  }

  static tooManyRequests(
    message = "Too many requests. Please slow down.",
  ): ApiError {
    return new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, message);
  }

  static internal(
    message = "Something went wrong. Please try again later.",
  ): ApiError {
    return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
  }

  static gone(
    message = "The requested resource is no longer available.",
  ): ApiError {
    return new ApiError(HTTP_STATUS.GONE, message);
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