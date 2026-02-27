import { z } from "zod";
import { objectIdSchema } from "./common.js";

// ─── Create channel ───────────────────────────────────────────────────────────

export const createChannelSchema = z.object({
    name: z
        .string()
        .min(1, "Channel name is required")
        .max(100, "Channel name cannot exceed 100 characters") // FIX: was 50, model allows 100
        .trim(),
    type: z.enum(["text", "voice"], {
        message: "Channel type must be 'text' or 'voice'",
    }),
    topic: z
        .string()
        .max(1024, "Topic cannot exceed 1024 characters") // FIX: was 200, model allows 1024
        .optional(),
    category: z.string().trim().optional(),
    position: z.number().int().min(0).optional(),
    isPrivate: z.boolean().optional(),
    allowedRoles: z.array(objectIdSchema).optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

// ─── Update channel ───────────────────────────────────────────────────────────

export const updateChannelSchema = z.object({
    name: z
        .string()
        .min(1, "Channel name is required")
        .max(100, "Channel name cannot exceed 100 characters")
        .trim()
        .optional(),
    topic: z
        .string()
        .max(1024, "Topic cannot exceed 1024 characters")
        .optional(),
    category: z.string().trim().optional(),
    position: z.number().int().min(0).optional(),
    isPrivate: z.boolean().optional(),
    allowedRoles: z.array(objectIdSchema).optional(),
});

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

// ─── Reorder channels ─────────────────────────────────────────────────────────

export const reorderChannelsSchema = z.object({
    channelOrder: z
        .array(
            z.object({
                channelId: objectIdSchema,
                position: z.number().int().min(0),
            }),
        )
        .min(1, "channelOrder must contain at least one channel"),
});

export type ReorderChannelsInput = z.infer<typeof reorderChannelsSchema>;

// ─── Param schemas ────────────────────────────────────────────────────────────
// Re-exported for convenience — routes can import everything from one place.

export { channelIdParamSchema } from "./common.js";
export type { ChannelIdParam } from "./common.js";