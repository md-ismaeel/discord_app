import { z } from "zod";

export const updateMemberRoleSchema = z.object({
    role: z.enum(["admin", "moderator", "member"], {
        errorMap: () => ({ message: "Role must be admin, moderator, or member" }),
    }),
});

export const memberIdParamSchema = z.object({
    memberId: z
        .string()
        .regex(/^[0-9a-fA-F]{24}$/, "Invalid member ID format"),
});

export const kickMemberSchema = z.object({
    reason: z
        .string()
        .max(500, "Reason cannot exceed 500 characters")
        .optional(),
});

export const banMemberSchema = z.object({
    reason: z
        .string()
        .max(500, "Reason cannot exceed 500 characters")
        .optional(),
    deleteMessageDays: z
        .number()
        .int()
        .min(0)
        .max(7, "Can only delete messages from the last 7 days")
        .optional()
        .default(0),
});

