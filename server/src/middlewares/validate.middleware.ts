import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodSchema, ZodError, type ZodIssue } from "zod";
import { ApiError } from "@/utils/ApiError";
import { HTTP_STATUS } from "@/constants/httpStatus";

//  Types
export interface ValidationFieldError {
  field: string;
  message: string;
}

/** Map Zod issues to the flat `{ field, message }[]` shape used by the API. */
const formatZodError = (error: ZodError): ValidationFieldError[] =>
  error.issues.map((issue: ZodIssue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "unknown",
    message: issue.message,
  }));

/** Shared Zod parsing logic — throws next(ApiError) on failure. */
const parseWith = <T>(
  schema: ZodSchema<T>,
  data: unknown,
  errorMessage: string,
  next: NextFunction,
): T | undefined => {
  try {
    return schema.parse(data ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      next(
        new ApiError(
          HTTP_STATUS.BAD_REQUEST,
          errorMessage,
          formatZodError(err),
        ),
      );
      return undefined;
    }
    next(err);
    return undefined;
  }
};

// Middleware factories

/**
 * Validate and replace `req.body` using a Zod schema.
 * Strips unknown fields (Zod default) and enforces types.
 */
export const validateBody = <T>(schema: ZodSchema<T>): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = parseWith(schema, req.body, "Validation failed.", next);
    if (result !== undefined) {
      req.body = result as Record<string, unknown>;
      next();
    }
  };

/**
 * Validate `req.params` using a Zod schema.
 * Useful for ensuring route params are the expected shape (e.g. valid UUIDs).
 */
export const validateParams = <T>(schema: ZodSchema<T>): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = parseWith(schema, req.params, "Invalid route parameters.", next);
    if (result !== undefined) {
      req.params = result as Record<string, string>;
      next();
    }
  };

/**
 * Validate `req.query` using a Zod schema.
 */
export const validateQuery = <T>(schema: ZodSchema<T>): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = parseWith(
      schema,
      req.query,
      "Invalid query parameters.",
      next,
    );
    if (result !== undefined) {
      req.query = result as Record<string, string>;
      next();
    }
  };

/**
 * Combined validator for body + params in a single middleware.
 * Both schemas are optional — pass `null` to skip either.
 */
export const validate = <B, P>(
  bodySchema: ZodSchema<B> | null,
  paramsSchema: ZodSchema<P> | null,
): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (bodySchema) {
      const body = parseWith(bodySchema, req.body, "Validation failed.", next);
      if (body === undefined) return;
      req.body = body as Record<string, unknown>;
    }

    if (paramsSchema) {
      const params = parseWith(
        paramsSchema,
        req.params,
        "Invalid route parameters.",
        next,
      );
      if (params === undefined) return;
      req.params = params as Record<string, string>;
    }

    next();
  };

export default { validateBody, validateParams, validateQuery, validate };