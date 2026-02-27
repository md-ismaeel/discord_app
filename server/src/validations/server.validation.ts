import { z } from "zod";

export const createServerSchema = z.object({
  name: z
    .string()
    .min(2, "Server name must be at least 2 characters")
    .max(100, "Server name cannot exceed 100 characters"),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),
  icon: z.string().url().optional(),
  banner: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

export const updateServerSchema = z.object({
  name: z
    .string()
    .min(2, "Server name must be at least 2 characters")
    .max(100, "Server name cannot exceed 100 characters")
    .optional(),
  description: z
    .string()
    .max(500, "Description cannot exceed 500 characters")
    .optional(),
  icon: z.string().url().optional(),
  banner: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

export const serverIdParamSchema = z.object({
  serverId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid server ID format"),
});

export const serverMemberIdParamSchema = z.object({
  serverId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid server ID"),
  memberId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid member ID"),
});
