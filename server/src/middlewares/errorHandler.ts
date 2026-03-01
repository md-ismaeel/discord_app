import type { Request, Response, NextFunction } from "express";
import { sendError, sendBadRequest, sendConflict } from "@/utils/response";
import { isApiError } from "@/utils/ApiError";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { HTTP_STATUS, type HttpStatus } from "@/constants/httpStatus";

// ─── Mongoose error types
// Mongoose doesn't export these as public types so we define minimal shapes.

interface MongooseValidationError extends Error {
  name: "ValidationError";
  errors: Record<string, { message: string }>;
}

interface MongoDuplicateKeyError extends Error {
  code: 11000;
  keyPattern: Record<string, unknown>;
}

interface MongooseCastError extends Error {
  name: "CastError";
}

// ─── Type guards
const isValidationError = (err: unknown): err is MongooseValidationError => (err as Error)?.name === "ValidationError";
const isDuplicateKeyError = (err: unknown): err is MongoDuplicateKeyError => (err as MongoDuplicateKeyError)?.code === 11000;
const isCastError = (err: unknown): err is MongooseCastError => (err as Error)?.name === "CastError";

// ─── Global error handler
// Must have exactly 4 parameters — Express identifies error handlers this way.
// Register as the LAST middleware: app.use(errorHandler)

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  // Always log the full error server-side for debugging
  console.error(`[${req.method} ${req.originalUrl}]`, err);

  // ── Mongoose: field-level validation failure
  if (isValidationError(err)) {
    const errors = Object.values(err.errors).map((e) => e.message);
    sendBadRequest(res, ERROR_MESSAGES.VALIDATION_ERROR, errors);
    return;
  }

  // ── MongoDB: unique index violation
  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyPattern)[0] ?? "field";
    sendConflict(res, `${field} already exists.`);
    return;
  }

  // ── Mongoose: invalid ObjectId cast 
  if (isCastError(err)) {
    sendBadRequest(res, "Invalid ID format.");
    return;
  }

  // ── Our own ApiError
  if (isApiError(err)) {
    sendError(res, err.message, err.statusCode as HttpStatus, err.errors);
    return;
  }

  // ── Fallback: unexpected server error
  // Never expose internal error details to the client in production.
  sendError(res, ERROR_MESSAGES.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR);
};