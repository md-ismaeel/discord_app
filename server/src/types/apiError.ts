// types/apiError.ts
export interface ApiErrorType extends Error {
  statusCode: number;
  errors?: any;
  success: boolean;
}
