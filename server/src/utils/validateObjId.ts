import mongoose from "mongoose";
import { ApiError } from "./ApiError.js";

// ─── Types 

// Acceptable input types — strings come from req.params; ObjectIds from model refs
type ObjectIdInput = string | mongoose.Types.ObjectId;

// ─── Helpers

/**
 * Assert that `id` is a non-empty, valid MongoDB ObjectId.
 * Throws `ApiError.badRequest` with a descriptive message if validation fails.
 *
 * @param id        - The value to validate (typically from req.params)
 * @param fieldName - Human-readable field label used in the error message
 * @returns The original `id` value, narrowed to `string | Types.ObjectId`
 *
 * @example
 *   const userId = validateObjectId(req.params.userId, "userId");
 *   const user = await UserModel.findById(userId);
 */
export const validateObjectId = (id: ObjectIdInput | undefined | null, fieldName = "ID"): string => {
  if (!id) {
    throw ApiError.badRequest(`${fieldName} is required.`);
  }

  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.badRequest(`${fieldName} is not a valid MongoDB ObjectId.`);
  }

  return id.toString();
};