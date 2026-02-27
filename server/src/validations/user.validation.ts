import { z } from "zod";

// User Validations
export const createUserSchema = z.object({
    name: z
        .string()
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name cannot exceed 50 characters")
        .trim(),
    email: z
        .string()
        .email("Please provide a valid email")
        .toLowerCase()
        .trim(),
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(30, "Username cannot exceed 30 characters")
        .trim()
        .optional(),
    avatar: z.string().url("Avatar must be a valid URL").optional().nullable(),
    provider: z.enum(["google", "github", "discord"]),
    providerId: z.string().optional(),
});

export const updateUserSchema = z.object({
    name: z
        .string()
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name cannot exceed 50 characters")
        .trim()
        .optional(),
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(30, "Username cannot exceed 30 characters")
        .trim()
        .optional(),
    avatar: z.string().url("Avatar must be a valid URL").optional().nullable(),
    status: z.enum(["online", "offline", "away", "dnd"]).optional(),
    customStatus: z
        .string()
        .max(128, "Status cannot exceed 128 characters")
        .optional(),
    bio: z
        .string()
        .max(190, "Bio cannot exceed 190 characters")
        .optional(),
});

// Friend Request Validations
export const addFriendSchema = z.object({
    friendId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID"),
});

export const removeFriendSchema = z.object({
    friendId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID"),
});

// Server Validations
export const createServerSchema = z.object({
    name: z
        .string()
        .min(2, "Server name must be at least 2 characters")
        .max(100, "Server name cannot exceed 100 characters")
        .trim(),
    description: z
        .string()
        .max(500, "Description cannot exceed 500 characters")
        .optional(),
    icon: z.string().url("Icon must be a valid URL").optional().nullable(),
});

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
        .optional(),
    icon: z.string().url("Icon must be a valid URL").optional().nullable(),
});

// Message Validations
export const sendMessageSchema = z.object({
    content: z
        .string()
        .min(1, "Message cannot be empty")
        .max(2000, "Message cannot exceed 2000 characters")
        .trim(),
    roomId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid room ID"),
    attachments: z.array(z.string().url()).optional(),
});

// Channel Validations
export const createChannelSchema = z.object({
    name: z
        .string()
        .min(1, "Channel name is required")
        .max(100, "Channel name cannot exceed 100 characters")
        .trim(),
    type: z.enum(["text", "voice"]),
    serverId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid server ID"),
});