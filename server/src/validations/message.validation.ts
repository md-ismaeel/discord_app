import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common.js";

//  Attachment sub-schema
const attachmentSchema = z.object({
    url: z.string().url("Attachment URL must be valid"),
    filename: z.string().min(1, "Filename is required"),
    size: z.number().int().positive("File size must be a positive integer"),
    type: z.string().min(1, "MIME type is required"),
});

//  Send message 
// FIX: user_validation.ts had sendMessageSchema with max 2000 and a `roomId`
export const sendMessageSchema = z.object({
    content: z
        .string()
        .min(1, "Message cannot be empty")
        .max(4000, "Message cannot exceed 4000 characters")
        .trim(),
    channelId: objectIdSchema.describe("Channel this message belongs to"),
    serverId: objectIdSchema.describe("Server this message belongs to"),
    replyTo: objectIdSchema.optional(),
    mentions: z.array(objectIdSchema).optional(),
    attachments: z.array(attachmentSchema).max(10, "Cannot attach more than 10 files").optional(),
});

//  Edit message 
export const editMessageSchema = z.object({
    content: z
        .string()
        .min(1, "Message content cannot be empty")
        .max(4000, "Message cannot exceed 4000 characters")
        .trim(),
});

//  Get messages (paginated) 
export const getMessagesSchema = paginationSchema.extend({
    before: objectIdSchema.optional(), // cursor-based: messages before this ID
    after: objectIdSchema.optional(),  // cursor-based: messages after this ID
});

// Add / remove reaction 
export const reactionSchema = z.object({
    emoji: z
        .string()
        .min(1, "Emoji is required")
        .max(32, "Emoji string is too long"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type GetMessagesQuery = z.infer<typeof getMessagesSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;