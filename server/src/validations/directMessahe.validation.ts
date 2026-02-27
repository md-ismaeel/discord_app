import { z } from "zod";
import { objectIdSchema, paginationSchema, userIdParamSchema } from "./common.js";

// ─── Attachment sub-schema ────────────────────────────────────────────────────

const attachmentSchema = z.object({
    url: z.string().url("Attachment URL must be valid"),
    filename: z.string().min(1, "Filename is required"),
    size: z.number().int().positive("File size must be a positive integer"),
    type: z.string().min(1, "MIME type is required"),
});

// ─── Send DM ──────────────────────────────────────────────────────────────────

export const sendDirectMessageSchema = z.object({
    content: z
        .string()
        .min(1, "Message cannot be empty")
        .max(4000, "Message cannot exceed 4000 characters")
        .trim(),
    receiverId: objectIdSchema.describe("Recipient user ID"),
    attachments: z
        .array(attachmentSchema)
        .max(10, "Cannot attach more than 10 files")
        .optional(),
});

export type SendDirectMessageInput = z.infer<typeof sendDirectMessageSchema>;

// ─── Edit DM ──────────────────────────────────────────────────────────────────

export const editDirectMessageSchema = z.object({
    content: z
        .string()
        .min(1, "Message content cannot be empty")
        .max(4000, "Message cannot exceed 4000 characters")
        .trim(),
});

export type EditDirectMessageInput = z.infer<typeof editDirectMessageSchema>;

// ─── Get DM conversation (paginated) ─────────────────────────────────────────

export const getDirectMessagesSchema = paginationSchema.extend({
    before: objectIdSchema.optional(),
    after: objectIdSchema.optional(),
});

export type GetDirectMessagesQuery = z.infer<typeof getDirectMessagesSchema>;

// ─── Mark as read ─────────────────────────────────────────────────────────────

export const markAsReadSchema = z.object({
    messageIds: z
        .array(objectIdSchema)
        .min(1, "At least one message ID is required"),
});

export type MarkAsReadInput = z.infer<typeof markAsReadSchema>;

// ─── Param schemas ────────────────────────────────────────────────────────────

export { userIdParamSchema };
export type { UserIdParam } from "./common.js";