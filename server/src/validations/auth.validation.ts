import { z } from "zod";

// Defined once here so all auth schemas stay in sync with the user model limits.
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 100;
const NAME_MIN = 1;
const NAME_MAX = 50;
const BIO_MAX = 500;
const CUSTOM_STATUS_MAX = 128;

// Re-usable field definitions

const usernameField = z
    .string()
    .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
    .max(USERNAME_MAX, `Username cannot exceed ${USERNAME_MAX} characters`)
    .regex(USERNAME_REGEX, "Username can only contain letters, numbers, and underscores")
    .trim();

const emailField = z
    .string()
    .email("Please provide a valid email address")
    .toLowerCase()
    .trim();

const passwordField = z
    .string()
    .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX, `Password cannot exceed ${PASSWORD_MAX} characters`);

const nameField = z
    .string()
    .min(NAME_MIN, "Display name is required")
    .max(NAME_MAX, `Display name cannot exceed ${NAME_MAX} characters`)
    .trim();

const statusField = z.enum(["online", "offline", "away", "dnd"], {
    message: "Status must be one of: online, offline, away, dnd",
});

// Avatar accepts a URL string, an empty string (clear avatar), or null
const avatarField = z
    .string()
    .url("Avatar must be a valid URL")
    .or(z.literal(""))
    .nullable()
    .optional();

// Register

export const registerSchema = z.object({
    username: usernameField,
    email: emailField,
    password: passwordField,
    name: nameField,
});

export type RegisterInput = z.infer<typeof registerSchema>;

//  Login 
// FIX: the original schema allowed both email and username to be absent without
// any error. Added .refine() to enforce that at least one identifier is supplied.

export const loginSchema = z
    .object({
        email: emailField.optional(),
        username: usernameField.optional(),
        password: z.string().min(1, "Password is required"),
    })
    .refine((data) => data.email !== undefined || data.username !== undefined, {
        message: "Either email or username is required",
        path: ["email"],
    });

export type LoginInput = z.infer<typeof loginSchema>;

// Update profile
// FIX: original had two nearly identical update schemas (updateProfileSchema and
// updateUserProfileSchema). Merged into one authoritative schema.

export const updateProfileSchema = z.object({
    name: nameField.optional(),
    username: usernameField.optional(),
    avatar: avatarField,
    status: statusField.optional(),
    customStatus: z
        .string()
        .max(CUSTOM_STATUS_MAX, `Custom status cannot exceed ${CUSTOM_STATUS_MAX} characters`)
        .optional(),
    bio: z
        .string()
        .max(BIO_MAX, `Bio cannot exceed ${BIO_MAX} characters`)
        .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Change password
export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: passwordField,
        confirmPassword: z.string().min(1, "Please confirm your new password"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Update status
export const updateUserStatusSchema = z.object({
    status: statusField,
    customStatus: z
        .string()
        .max(CUSTOM_STATUS_MAX, `Custom status cannot exceed ${CUSTOM_STATUS_MAX} characters`)
        .optional(),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

//  Email verification
export const verifyEmailSchema = z.object({
    email: emailField,
    code: z
        .string()
        .length(6, "Verification code must be exactly 6 digits")
        .regex(/^\d{6}$/, "Verification code must contain only digits"),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// Password reset request
export const resetPasswordRequestSchema = z.object({
    email: emailField,
});

export type ResetPasswordRequestInput = z.infer<typeof resetPasswordRequestSchema>;

// Password reset
export const resetPasswordSchema = z
    .object({
        token: z.string().min(1, "Reset token is required"),
        newPassword: passwordField,
        confirmPassword: z.string().min(1, "Please confirm your password"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
    });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;