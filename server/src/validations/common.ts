import { z } from "zod";

// Re-usable ObjectId primitive
// Single source of truth — import this instead of copy-pasting the regex.

export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid MongoDB ObjectId format");

// Re-usable param schemas
// Centralised so every route that needs e.g. :serverId uses the same validation.

export const userIdParamSchema = z.object({
  userId: objectIdSchema.describe("MongoDB ObjectId of the target user"),
});

export const serverIdParamSchema = z.object({
  serverId: objectIdSchema.describe("MongoDB ObjectId of the target server"),
});

export const channelIdParamSchema = z.object({
  channelId: objectIdSchema.describe("MongoDB ObjectId of the target channel"),
});

export const messageIdParamSchema = z.object({
  messageId: objectIdSchema.describe("MongoDB ObjectId of the target message"),
});

export const roleIdParamSchema = z.object({
  roleId: objectIdSchema.describe("MongoDB ObjectId of the target role"),
});

export const memberIdParamSchema = z.object({
  memberId: objectIdSchema.describe("MongoDB ObjectId of the server member"),
});

export const emojiParamSchema = z.object({
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid message ID"),
  emoji: z.string().min(1, "Emoji is required"),
});

// Pagination
// Query params arrive as strings — coerce to numbers before validating.
// FIX: default() must receive the same type as the output after transform.
//      Original used .default("1") on a string→number transform, which breaks
//      in Zod v4 because default is applied after transform.

export const paginationSchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, "Page must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1, "Page must be at least 1"))
    .optional()
    .default(1),
  limit: z
    .string()
    .regex(/^\d+$/, "Limit must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100, "Limit must be between 1 and 100"))
    .optional()
    .default(20),
});

// Search for users by username or email
export const searchUsersSchema = z.object({
  q: z.string().min(1, "Search query required"),
  page: z
    .string()
    .regex(/^\d+$/, "Page must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1, "Page must be at least 1"))
    .optional()
    .default(1),
  limit: z
    .string()
    .regex(/^\d+$/, "Limit must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100, "Limit must be between 1 and 100"))
    .optional()
    .default(20),
});

// Inferred TypeScript types
// Controllers can import these instead of manually typing their request shapes.
export type PaginationQuery = z.infer<typeof paginationSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
export type ServerIdParam = z.infer<typeof serverIdParamSchema>;
export type ChannelIdParam = z.infer<typeof channelIdParamSchema>;
export type MessageIdParam = z.infer<typeof messageIdParamSchema>;
export type RoleIdParam = z.infer<typeof roleIdParamSchema>;
export type MemberIdParam = z.infer<typeof memberIdParamSchema>;
