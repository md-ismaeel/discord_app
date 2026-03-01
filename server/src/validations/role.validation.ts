import { z } from "zod";
import { objectIdSchema } from "./common.js";

// Permissions sub-schema
// Every field is optional here so partial permission updates are valid.
// The model provides defaults for any field not explicitly set.

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

export type PermissionsInput = z.infer<typeof permissionsSchema>;

//  Create role
export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(100, "Role name cannot exceed 100 characters") // FIX: was 50, model allows 100
    .trim(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code (e.g. #99AAB5)")
    .optional(),
  permissions: permissionsSchema.optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

//  Update role 
export const updateRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(100, "Role name cannot exceed 100 characters")
    .trim()
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex code (e.g. #99AAB5)")
    .optional(),
  permissions: permissionsSchema.optional(),
  position: z.number().int().min(0, "Position cannot be negative").optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

//  Reorder roles
export const reorderRolesSchema = z.object({
  roleOrder: z
    .array(
      z.object({
        roleId: objectIdSchema,
        position: z.number().int().min(0),
      }),
    )
    .min(1, "roleOrder must contain at least one role"),
});

export type ReorderRolesInput = z.infer<typeof reorderRolesSchema>;

//  Param schemas
export { serverIdParamSchema, roleIdParamSchema } from "./common.js";
export type { ServerIdParam, RoleIdParam } from "./common.js";

export const memberRoleParamSchema = z.object({
  serverId: objectIdSchema,
  memberId: objectIdSchema,
  roleId: objectIdSchema,
});

export type MemberRoleParam = z.infer<typeof memberRoleParamSchema>;