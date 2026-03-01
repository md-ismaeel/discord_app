import { z } from "zod";
import { objectIdSchema } from "./common.js";

// ─── Constants (kept in sync with user.model limits) ──────────────────────────

const NAME_MIN = 2;
const NAME_MAX = 50;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const BIO_MAX = 500;          // FIX: was 190 — model allows 500
const CUSTOM_STATUS_MAX = 128; // FIX: label was "Status" — should be "Custom status"

// ─── Create user (admin / OAuth flow) ────────────────────────────────────────
// FIX: provider enum included "discord" which is not in IUser — removed.
// Supported providers match the model: email | google | github | facebook.

export const createUserSchema = z.object({
    name: z
        .string()
        .min(NAME_MIN, `Name must be at least ${NAME_MIN} characters`)
        .max(NAME_MAX, `Name cannot exceed ${NAME_MAX} characters`)
        .trim(),
    email: z
        .string()
        .email("Please provide a valid email address")
        .toLowerCase()
        .trim(),
    username: z
        .string()
        .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
        .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
        .regex(USERNAME_REGEX, "Username can only contain letters, numbers, and underscores")
        .trim()
        .optional(),
    avatar: z.string().url("Avatar must be a valid URL").nullable().optional(),
    provider: z.enum(["email", "google", "github", "facebook"], {
        error: "Provider must be one of: email, google, github, facebook",
    }),
    providerId: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// ─── Update user ──────────────────────────────────────────────────────────────

export const updateUserSchema = z.object({
    name: z
        .string()
        .min(NAME_MIN, `Name must be at least ${NAME_MIN} characters`)
        .max(NAME_MAX, `Name cannot exceed ${NAME_MAX} characters`)
        .trim()
        .optional(),
    username: z
        .string()
        .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
        .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
        .regex(USERNAME_REGEX, "Username can only contain letters, numbers, and underscores")
        .trim()
        .optional(),
    avatar: z.string().url("Avatar must be a valid URL").nullable().optional(),
    status: z
        .enum(["online", "offline", "away", "dnd"], {
            error: "Status must be one of: online, offline, away, dnd",
        })
        .optional(),
    customStatus: z
        .string()
        .max(CUSTOM_STATUS_MAX, `Custom status cannot exceed ${CUSTOM_STATUS_MAX} characters`)
        .optional(),
    bio: z
        .string()
        .max(BIO_MAX, `Bio cannot exceed ${BIO_MAX} characters`)
        .optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ─── Friend request params ────────────────────────────────────────────────────

export const friendIdSchema = z.object({
    friendId: objectIdSchema.describe("MongoDB ObjectId of the target user"),
});

export type FriendIdParam = z.infer<typeof friendIdSchema>;

// NOTE: createServerSchema, updateServerSchema, sendMessageSchema,
// and createChannelSchema were duplicated here from their dedicated files.
// Import them directly from server.validation, message.validation, and
// channel.validation instead to avoid drift between the two definitions.