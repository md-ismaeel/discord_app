import { z } from "zod";

export const createChannelSchema = z.object({
    name: z.string().min(1, "Channel name is required").max(50, "Channel name cannot exceed 50 characters"),
    type: z.enum(["text", "voice"], {
        errorMap: () => ({ message: "Channel type must be text or voice" }),
    }),
    topic: z.string().max(200, "Topic cannot exceed 200 characters").optional(),
    category: z.string().optional(),
    position: z.number().int().min(0).optional(),
    isPrivate: z.boolean().optional(),
    allowedRoles: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
});

export const updateChannelSchema = z.object({
    name: z.string().min(1, "Channel name is required").max(50, "Channel name cannot exceed 50 characters").optional(),
    topic: z.string().max(200, "Topic cannot exceed 200 characters").optional(),
    category: z.string().optional(),
    position: z.number().int().min(0).optional(),
    isPrivate: z.boolean().optional(),
    allowedRoles: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
});

export const reorderChannelsSchema = z.object({
    channelOrder: z.array(z.object({
        channelId: z.string().regex(/^[0-9a-fA-F]{24}$/),
        position: z.number().int().min(0),
    })).min(1, "channelOrder must contain at least one channel"),
});

export const channelIdParamSchema = z.object({
    channelId: z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid channel ID format"),
});