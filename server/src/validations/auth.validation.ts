import { z } from "zod";

// Shared validation constants for consistency
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 100;
const NAME_MIN = 1;
const NAME_MAX = 50;
const BIO_MAX = 500;
const CUSTOM_STATUS_MAX = 128;

// User Registration Schema
export const registerSchema = z.object({
    username: z
        .string()
        .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
        .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
        .regex(USERNAME_REGEX, "Username can only contain letters, numbers, and underscores")
        .trim(),
    email: z
        .string()
        .email("Please provide a valid email address")
        .toLowerCase()
        .trim(),
    password: z
        .string()
        .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
        .max(PASSWORD_MAX, `Password cannot exceed ${PASSWORD_MAX} characters`),
    name: z
        .string()
        .min(NAME_MIN, "Display name is required") // ✅ Fixed message
        .max(NAME_MAX, `Display name cannot exceed ${NAME_MAX} characters`)
        .trim(),
});

// User Login Schema
export const loginSchema = z.object({
    email: z
        .string()
        .email("Please provide a valid email")
        .toLowerCase()
        .trim()
        .optional(),
    username: z
        .string()
        .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
        .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
        .trim()
        .optional(),
    password: z
        .string()
        .min(1, "Password is required"),
});

// Update Profile Schema (for general profile updates)
export const updateProfileSchema = z.object({
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
    avatar: z
        .string()
        .url("Avatar must be a valid URL")
        .optional()
        .or(z.literal(""))
        .nullable(),
    status: z
        .enum(["online", "offline", "away", "dnd"], {
            errorMap: () => ({ message: "Status must be one of: online, offline, away, dnd" })
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

// Update User Profile Schema (comprehensive profile update)
export const updateUserProfileSchema = z.object({
    username: z
        .string()
        .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
        .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
        .regex(USERNAME_REGEX, "Username can only contain letters, numbers, and underscores")
        .trim()
        .optional(),
    name: z
        .string()
        .min(NAME_MIN, "Display name cannot be empty")
        .max(NAME_MAX, `Display name cannot exceed ${NAME_MAX} characters`)
        .trim()
        .optional(),
    avatar: z
        .string()
        .url("Avatar must be a valid URL")
        .optional()
        .or(z.literal(""))
        .nullable(),
    bio: z
        .string()
        .max(BIO_MAX, `Bio cannot exceed ${BIO_MAX} characters`)
        .optional(),
    status: z
        .enum(["online", "offline", "away", "dnd"], {
            errorMap: () => ({ message: "Status must be one of: online, offline, away, dnd" })
        })
        .optional(),
    customStatus: z
        .string()
        .max(CUSTOM_STATUS_MAX, `Custom status cannot exceed ${CUSTOM_STATUS_MAX} characters`)
        .optional(),
});

// Change Password Schema
export const changePasswordSchema = z.object({
    currentPassword: z
        .string()
        .min(1, "Current password is required"),
    newPassword: z
        .string()
        .min(PASSWORD_MIN, `New password must be at least ${PASSWORD_MIN} characters`)
        .max(PASSWORD_MAX, `New password cannot exceed ${PASSWORD_MAX} characters`),
    confirmPassword: z
        .string()
        .min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

// Update User Status Schema
export const updateUserStatusSchema = z.object({
    status: z
        .enum(["online", "offline", "away", "dnd"], {
            errorMap: () => ({ message: "Status must be one of: online, offline, away, dnd" })
        }),
    customStatus: z
        .string()
        .max(CUSTOM_STATUS_MAX, `Custom status cannot exceed ${CUSTOM_STATUS_MAX} characters`)
        .optional(),
});

// Email Verification Schema
export const verifyEmailSchema = z.object({
    email: z
        .string()
        .email("Please provide a valid email address")
        .toLowerCase()
        .trim(),
    code: z
        .string()
        .length(6, "Verification code must be 6 digits")
        .regex(/^\d+$/, "Verification code must contain only numbers"),
});

// Reset Password Request Schema
export const resetPasswordRequestSchema = z.object({
    email: z
        .string()
        .email("Please provide a valid email address")
        .toLowerCase()
        .trim(),
});

// Reset Password Schema
export const resetPasswordSchema = z.object({
    token: z
        .string()
        .min(1, "Reset token is required"),
    newPassword: z
        .string()
        .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
        .max(PASSWORD_MAX, `Password cannot exceed ${PASSWORD_MAX} characters`),
    confirmPassword: z
        .string()
        .min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});