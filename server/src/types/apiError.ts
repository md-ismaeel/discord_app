// types/apiError.ts
export interface ApiErrorType extends Error {
  statusCode: number;
  errors?: unknown[];
  success: boolean;
}
