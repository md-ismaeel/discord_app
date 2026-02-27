import { z } from "zod";
import { objectIdSchema } from "./common.js";

// ─── Create server ────────────────────────────────────────────────────────────

export const createServerSchema = z.object({
  name: z
    .string()
    .min(2, "Server name must be at least 2 characters")
    .max(100, "Server name cannot exceed 100 characters")
    .trim(),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .trim()
    .optional(),
  icon: z.string().url("Icon must be a valid URL").optional(),
  banner: z.string().url("Banner must be a valid URL").optional(),
  isPublic: z.boolean().optional(),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;

// ─── Update server ────────────────────────────────────────────────────────────

export const updateServerSchema = z.object({
  name: z
    .string()
    .min(2, "Server name must be at least 2 characters")
    .max(100, "Server name cannot exceed 100 characters")
    .trim()
    .optional(),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .trim()
    .optional(),
  icon: z.string().url("Icon must be a valid URL").nullable().optional(),
  banner: z.string().url("Banner must be a valid URL").nullable().optional(),
  isPublic: z.boolean().optional(),
});

export type UpdateServerInput = z.infer<typeof updateServerSchema>;

// ─── Transfer ownership ───────────────────────────────────────────────────────

export const transferOwnershipSchema = z.object({
  newOwnerId: objectIdSchema.describe("User ID of the new server owner"),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

// ─── Param schemas ────────────────────────────────────────────────────────────
// Re-exported from common so routes can import everything from one place.

export { serverIdParamSchema } from "./common.js";
export type { ServerIdParam } from "./common.js";

export const serverMemberIdParamSchema = z.object({
  serverId: objectIdSchema,
  memberId: objectIdSchema,
});

export type ServerMemberIdParam = z.infer<typeof serverMemberIdParamSchema>;