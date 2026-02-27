import { ApiErrorType } from "../types/apiError";

export const createApiError = (
  statusCode: number,
  message: string,
  errors: any = null,
): ApiErrorType => {
  const error = new Error(message) as ApiErrorType;

  error.statusCode = statusCode;
  error.errors = errors;
  error.success = false;

  return error;
};
