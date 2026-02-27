import { Request, Response, NextFunction } from "express";
import { sendError, sendBadRequest, sendConflict } from "../utils/response";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { HTTP_STATUS } from "../constants/httpStatus";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error("Error:", err);

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e: any) => e.message);
    sendBadRequest(res, ERROR_MESSAGES.VALIDATION_ERROR, errors);
    return;
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    sendConflict(res, `${field} already exists`);
    return;
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === "CastError") {
    sendBadRequest(res, "Invalid ID format");
    return;
  }

  // Custom API errors
  if (err.statusCode) {
    sendError(res, err.message, err.statusCode, err.errors);
    return;
  }

  // Default server error
  sendError(
    res,
    ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
    HTTP_STATUS.INTERNAL_SERVER_ERROR
  );
};