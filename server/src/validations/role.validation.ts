import { z } from "zod";

export const permissionsSchema = z.object({
  administrator: z.boolean().optional(),
  manageServer: z.boolean().optional(),
  manageRoles: z.boolean().optional(),
  manageChannels: z.boolean().optional(),
  kickMembers: z.boolean().optional(),
  banMembers: z.boolean().optional(),
  createInvite: z.boolean().optional(),
  manageMessages: z.boolean().optional(),
  sendMessages: z.boolean().optional(),
  readMessages: z.boolean().optional(),
  mentionEveryone: z.boolean().optional(),
  connect: z.boolean().optional(),
  speak: z.boolean().optional(),
  muteMembers: z.boolean().optional(),
  deafenMembers: z.boolean().optional(),
});

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name cannot exceed 50 characters"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format")
    .optional(),
  permissions: permissionsSchema.optional(),
});

export const updateRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name cannot exceed 50 characters")
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format")
    .optional(),
  permissions: permissionsSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderRolesSchema = z.object({
  roleOrder: z
    .array(
      z.object({
        roleId: z.string().regex(/^[0-9a-fA-F]{24}$/),
        position: z.number().int().min(0),
      }),
    )
    .min(1, "roleOrder must contain at least one role"),
});

export const serverIdParamSchema = z.object({
  serverId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid server ID"),
});

export const roleIdParamSchema = z.object({
  roleId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid role ID"),
});

export const memberRoleParamSchema = z.object({
  serverId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid server ID"),
  memberId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid member ID"),
  roleId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid role ID"),
});
