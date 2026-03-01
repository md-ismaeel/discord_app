import type { Response } from "express";
import { HTTP_STATUS, type HttpStatus } from "@/constants/httpStatus";

// ─── Response shape
// All API responses share this envelope so clients always know what to expect.

interface SuccessResponse<T> {
    success: true;
    message: string;
    data: T;
}

interface ErrorResponse {
    success: false;
    message: string;
    errors?: unknown;
}

// ─── Success helpers

/** 200 OK — standard success with data payload */
export const sendSuccess = <T>(
    res: Response,
    data: T,
    message = "Success",
): Response<SuccessResponse<T>> =>
    res.status(HTTP_STATUS.OK).json({ success: true, message, data });

/** 201 Created — resource was created successfully */
export const sendCreated = <T>(
    res: Response,
    data: T,
    message = "Created successfully",
): Response<SuccessResponse<T>> =>
    res.status(HTTP_STATUS.CREATED).json({ success: true, message, data });

/** 204 No Content — operation succeeded but there is no body to return */
export const sendNoContent = (res: Response): Response =>
    res.status(HTTP_STATUS.NO_CONTENT).send();

// ─── Error helpers

/** 400 Bad Request */
export const sendBadRequest = (
    res: Response,
    message: string,
    errors?: unknown,
): Response<ErrorResponse> =>
    res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message, errors });

/** 401 Unauthorized */
export const sendUnauthorized = (
    res: Response,
    message = "Authentication required.",
): Response<ErrorResponse> =>
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ success: false, message });

/** 403 Forbidden */
export const sendForbidden = (
    res: Response,
    message = "Access denied.",
): Response<ErrorResponse> =>
    res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message });

/** 404 Not Found */
export const sendNotFound = (
    res: Response,
    message: string,
): Response<ErrorResponse> =>
    res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message });

/** 409 Conflict */
export const sendConflict = (
    res: Response,
    message: string,
): Response<ErrorResponse> =>
    res.status(HTTP_STATUS.CONFLICT).json({ success: false, message });

/** 429 Too Many Requests */
export const sendTooManyRequests = (
    res: Response,
    message = "Too many requests. Please slow down.",
    errors?: unknown,
): Response<ErrorResponse> =>
    res
        .status(HTTP_STATUS.TOO_MANY_REQUESTS)
        .json({ success: false, message, errors });

/**
 * Generic error sender — used by the global error handler.
 * Prefer the specific helpers above in controllers.
 */
export const sendError = (
    res: Response,
    message: string,
    statusCode: HttpStatus,
    errors?: unknown,
): Response<ErrorResponse> =>
    res.status(statusCode).json({ success: false, message, errors });
