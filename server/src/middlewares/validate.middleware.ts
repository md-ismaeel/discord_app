import { ZodError } from "zod";
import { createApiError } from "../utils/ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

//  * Format Zod validation errors into a clean API response structure
//  * @param {ZodError} error - Zod error object
//  * @returns {Array<{field: string, message: string}>}
const formatZodError = (error) => {
  // Check if error has the issues property (Zod uses 'issues' not 'errors')
  const issues = error.issues || error.errors || [];

  if (!Array.isArray(issues) || issues.length === 0) {
    console.error("Unexpected Zod error structure:", error);
    return [
      {
        field: "unknown",
        message: error.message || "Validation error occurred",
      },
    ];
  }

  return issues.map((issue) => ({
    field:
      issue.path && issue.path.length > 0 ? issue.path.join(".") : "unknown",
    message: issue.message || "Validation error",
  }));
};

//  * Validate request body using a Zod schema
//  * - Parses and sanitizes req.body
//  * - Replaces req.body with validated data
//  * - Forwards Zod errors to global error handler
export const validateBody = (schema) => (req, res, next) => {
  try {
    // Parse the body - this will throw if validation fails
    const data = schema.parse(req.body ?? {});
    req.body = data;
    next();
  } catch (error) {
    // Handle Zod validation errors
    if (error?.name === "ZodError" || error instanceof ZodError) {
      const formattedErrors = formatZodError(error);
      console.error("Zod Validation Failed:");
      console.error("Formatted Errors:", formattedErrors);

      return next(
        createApiError(
          HTTP_STATUS.BAD_REQUEST,
          "Validation failed",
          formattedErrors,
        ),
      );
    }

    // Handle other errors
    console.error("Non-Zod error in validation:", error);
    return next(error);
  }
};

//  * Validate route params (req.params) using a Zod schema
export const validateParams = (schema) => (req, res, next) => {
  try {
    const data = schema.parse(req.params ?? {});
    req.params = data;
    next();
  } catch (error) {
    if (error?.name === "ZodError" || error instanceof ZodError) {
      const formattedErrors = formatZodError(error);
      return next(
        createApiError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid parameters",
          formattedErrors,
        ),
      );
    }
    return next(error);
  }
};

//  * Validate query string parameters (req.query) using a Zod schema
export const validateQuery = (schema) => (req, res, next) => {
  try {
    const data = schema.parse(req.query ?? {});
    req.query = data;
    next();
  } catch (error) {
    if (error?.name === "ZodError" || error instanceof ZodError) {
      const formattedErrors = formatZodError(error);
      return next(
        createApiError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid query parameters",
          formattedErrors,
        ),
      );
    }
    return next(error);
  }
};

//  * Combined validator for both body and params
export const validate = (bodySchema, paramsSchema) => (req, res, next) => {
  try {
    if (bodySchema) {
      req.body = bodySchema.parse(req.body ?? {});
    }
    if (paramsSchema) {
      req.params = paramsSchema.parse(req.params ?? {});
    }
    next();
  } catch (error) {
    if (error?.name === "ZodError" || error instanceof ZodError) {
      const formattedErrors = formatZodError(error);
      return next(
        createApiError(
          HTTP_STATUS.BAD_REQUEST,
          "Validation failed",
          formattedErrors,
        ),
      );
    }
    return next(error);
  }
};

export default {
  validateBody,
  validateParams,
  validateQuery,
  validate,
};
