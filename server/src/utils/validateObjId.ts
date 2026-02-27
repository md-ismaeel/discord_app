import mongoose from "mongoose";
import { createApiError } from "./ApiError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

//  * Validate MongoDB ObjectId
//  * Throws error if ID is missing or invalid
export const validateObjectId = (id, fieldName = "ID") => {
  // Check if ID is present
  if (!id) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, `${fieldName} is required`);
  }

  // Check if ID is valid MongoDB ObjectId
  if (!mongoose.isValidObjectId(id)) {
    throw createApiError(
      HTTP_STATUS.BAD_REQUEST,
      `Invalid mongoose ${fieldName} format`,
    );
  }

  return id;
};
