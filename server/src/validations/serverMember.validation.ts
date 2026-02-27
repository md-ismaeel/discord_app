import { z } from "zod";
import { objectIdSchema } from "./common.js";

// ─── Update member hierarchy role ─────────────────────────────────────────────
// FIX: original allowed "admin" | "moderator" | "member" but NOT "owner".
// "owner" is intentionally excluded here — ownership is transferred via a
// dedicated transfer-ownership endpoint, not a generic role update.

export const updateMemberRoleSchema = z.object({
    role: z.enum(["admin", "moderator", "member"], {
        message: "Role must be one of: admin, moderator, member",
    }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

// ─── Assign / remove a permission role ───────────────────────────────────────

export const assignRoleSchema = z.object({
    roleId: objectIdSchema.describe("MongoDB ObjectId of the Role to assign"),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

// ─── Update nickname ──────────────────────────────────────────────────────────

export const updateNicknameSchema = z.object({
    nickname: z
        .string()
        .max(32, "Nickname cannot exceed 32 characters")
        .trim()
        .nullable(), // null = clear the nickname
});

export type UpdateNicknameInput = z.infer<typeof updateNicknameSchema>;

// ─── Kick member ──────────────────────────────────────────────────────────────

export const kickMemberSchema = z.object({
    reason: z
        .string()
        .max(500, "Reason cannot exceed 500 characters")
        .trim()
        .optional(),
});

export type KickMemberInput = z.infer<typeof kickMemberSchema>;

// ─── Ban member ───────────────────────────────────────────────────────────────

export const banMemberSchema = z.object({
    reason: z
        .string()
        .max(500, "Reason cannot exceed 500 characters")
        .trim()
        .optional(),
    deleteMessageDays: z
        .number()
        .int()
        .min(0)
        .max(7, "Can only delete messages from the last 7 days")
        .optional()
        .default(0),
});

export type BanMemberInput = z.infer<typeof banMemberSchema>;

// ─── Param schemas ────────────────────────────────────────────────────────────

export { memberIdParamSchema } from "./common.js";
export type { MemberIdParam } from "./common.js";