import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import type { IRole, IServerMember } from "@/types/models";
import { RoleModel } from "@/models/role.model";
import { ServerModel } from "@/models/server.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { pubClient } from "@/config/redis.config";
import { emitToServer } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";

// ─── Cache helpers
const CACHE_TTL = {
  ROLES: 900, // 15 minutes
  ROLE: 900,  // 15 minutes
} as const;

const getCacheKey = {
  serverRoles: (serverId: string) => `server:${serverId}:roles`,
  role: (roleId: string) => `role:${roleId}`,
};

const invalidateRoleCache = async (serverId: string, roleId?: string): Promise<void> => {
  const keys = [getCacheKey.serverRoles(serverId), `server:${serverId}`];
  if (roleId) keys.push(getCacheKey.role(roleId));
  await pubClient.del(...keys);
};

// ─── Permission helper
// IServerMember.role: "owner" | "admin" | "moderator" | "member"
const checkMemberPermission = async (
  serverId: string,
  userId: string,
  requiredRoles: IServerMember["role"][] = ["owner", "admin"],
): Promise<IServerMember> => {
  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: userId,
  });

  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  if (!requiredRoles.includes(membership.role)) {
    throw ApiError.forbidden(`Only ${requiredRoles.join(", ")} can perform this action.`);
  }

  return membership;
};

// ─── Create a new role
export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const { name, color, permissions } = req.body as {
    name: string;
    color?: string;
    // IRole.permissions — all known boolean flags
    permissions?: Partial<IRole["permissions"]>;
  };
  const userId = validateObjectId(req.user!._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const existingRole = await RoleModel.findOne({ server: serverId, name });
  if (existingRole) {
    throw ApiError.conflict("A role with this name already exists in this server.");
  }

  // Position = highest + 1, or 0 for the first role
  const highestRole = await RoleModel.findOne({ server: serverId })
    .sort({ position: -1 })
    .lean<IRole>();
  const position = highestRole ? highestRole.position + 1 : 0;

  const role = await RoleModel.create({
    name,
    // IRole.color: string (default "#99AAB5")
    color: color ?? "#99AAB5",
    server: serverId,
    permissions: permissions ?? {},
    position,
  });

  await invalidateRoleCache(serverId);

  emitToServer(serverId, "role:created", { role, createdBy: userId, timestamp: new Date() });

  return sendCreated(res, role, "Role created successfully.");
});

// ─── Get all roles in a server
export const getServerRoles = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin", "moderator", "member"]);

  const cacheKey = getCacheKey.serverRoles(serverId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  // Highest position first (most powerful role)
  const roles = await RoleModel.find({ server: serverId })
    .sort({ position: -1 })
    .lean<IRole[]>();

  await pubClient.setex(cacheKey, CACHE_TTL.ROLES, JSON.stringify(roles));

  return sendSuccess(res, roles, "Roles fetched successfully.");
});

// ─── Get a single role by ID
export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const { roleId } = req.params as { roleId: string };
  const userId = validateObjectId(req.user!._id);

  const cacheKey = getCacheKey.role(roleId);
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const role = JSON.parse(cached) as IRole;
    await checkMemberPermission(role.server.toString(), userId, [
      "owner", "admin", "moderator", "member",
    ]);
    return sendSuccess(res, role);
  }

  const role = await RoleModel.findById(roleId).lean<IRole>();
  if (!role) throw ApiError.notFound("Role not found.");

  await checkMemberPermission(role.server.toString(), userId, [
    "owner", "admin", "moderator", "member",
  ]);

  await pubClient.setex(cacheKey, CACHE_TTL.ROLE, JSON.stringify(role));

  return sendSuccess(res, role);
});

// ─── Update a role
export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const { roleId } = req.params as { roleId: string };
  const { name, color, permissions, position } = req.body as {
    name?: string;
    color?: string;
    permissions?: Partial<IRole["permissions"]>;
    position?: number;
  };
  const userId = validateObjectId(req.user!._id);

  const role = await RoleModel.findById<IRole>(roleId);
  if (!role) throw ApiError.notFound("Role not found.");

  await checkMemberPermission(role.server.toString(), userId, ["owner", "admin"]);

  // IRole.isDefault: boolean — protect core permissions on default role
  let mergedPermissions = permissions;
  if (role.isDefault && permissions) {
    mergedPermissions = {
      ...permissions,
      readMessages: true,
      sendMessages: true,
      connect: true,
      speak: true,
    };
  }

  if (name && name !== role.name) {
    const duplicate = await RoleModel.findOne({
      server: role.server,
      name,
      _id: { $ne: roleId },
    });
    if (duplicate) {
      throw ApiError.conflict("A role with this name already exists in this server.");
    }
    role.name = name;
  }

  if (color !== undefined) role.color = color;
  if (mergedPermissions !== undefined) {
    // IRole.permissions is a typed flat object — safe to spread
    role.permissions = { ...role.permissions, ...mergedPermissions } as IRole["permissions"];
  }
  if (position !== undefined) role.position = position;

  await role.save();
  await invalidateRoleCache(role.server.toString(), roleId);

  emitToServer(role.server.toString(), "role:updated", {
    role,
    updatedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, role, "Role updated successfully.");
});

// ─── Delete a role
export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const { roleId } = req.params as { roleId: string };
  const userId = validateObjectId(req.user!._id);

  const role = await RoleModel.findById<IRole>(roleId);
  if (!role) throw ApiError.notFound("Role not found.");

  // IRole.isDefault: boolean
  if (role.isDefault) throw ApiError.badRequest("Cannot delete the default role.");

  await checkMemberPermission(role.server.toString(), userId, ["owner", "admin"]);

  const serverId = role.server.toString();

  // Remove this role from all members who hold it
  await ServerMemberModel.updateMany(
    { server: serverId, roles: roleId },
    { $pull: { roles: roleId } },
  );

  await role.deleteOne();
  await invalidateRoleCache(serverId, roleId);

  emitToServer(serverId, "role:deleted", { roleId, deletedBy: userId, timestamp: new Date() });

  return sendSuccess(res, null, "Role deleted successfully.");
});

// ─── Reorder roles
export const reorderRoles = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const { roleOrder } = req.body as {
    roleOrder: Array<{ roleId: string; position: number }>;
  };
  const userId = validateObjectId(req.user!._id);

  if (!Array.isArray(roleOrder) || roleOrder.length === 0) {
    throw ApiError.badRequest("roleOrder must be a non-empty array.");
  }

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  await RoleModel.bulkWrite(
    roleOrder.map(({ roleId, position }) => ({
      updateOne: {
        filter: { _id: roleId, server: serverId },
        update: { $set: { position } },
      },
    })),
  );

  const roles = await RoleModel.find({ server: serverId })
    .sort({ position: -1 })
    .lean<IRole[]>();

  await invalidateRoleCache(serverId);

  emitToServer(serverId, "roles:reordered", {
    roles,
    reorderedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, roles, "Roles reordered successfully.");
});

// ─── Assign role to a member
export const assignRole = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, memberId, roleId } = req.params as {
    serverId: string;
    memberId: string;
    roleId: string;
  };
  const userId = validateObjectId(req.user!._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const role = await RoleModel.findOne<IRole>({ _id: roleId, server: serverId });
  if (!role) throw ApiError.notFound("Role not found in this server.");

  const member = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: memberId,
  });
  if (!member) throw ApiError.notFound("Member not found in this server.");

  if (!member.roles) member.roles = [];

  // IServerMember.roles: Types.ObjectId[] — compare as strings
  if (member.roles.some((id) => id.toString() === roleId)) {
    throw ApiError.badRequest("Member already has this role.");
  }

  member.roles.push(roleId as unknown as Types.ObjectId);
  await member.save();

  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  await Promise.all([
    invalidateRoleCache(serverId),
    pubClient.del(`server:${serverId}`),
  ]);

  emitToServer(serverId, "member:roleAssigned", {
    member: populatedMember,
    role,
    assignedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, populatedMember, "Role assigned successfully.");
});

// ─── Remove role from a member
export const removeRole = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, memberId, roleId } = req.params as {
    serverId: string;
    memberId: string;
    roleId: string;
  };
  const userId = validateObjectId(req.user!._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const member = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: memberId,
  });
  if (!member) throw ApiError.notFound("Member not found in this server.");

  // IServerMember.roles: Types.ObjectId[]
  if (!member.roles?.some((id) => id.toString() === roleId)) {
    throw ApiError.badRequest("Member doesn't have this role.");
  }

  member.roles = member.roles.filter((id) => id.toString() !== roleId);
  await member.save();

  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  await Promise.all([
    invalidateRoleCache(serverId),
    pubClient.del(`server:${serverId}`),
  ]);

  emitToServer(serverId, "member:roleRemoved", {
    member: populatedMember,
    roleId,
    removedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, populatedMember, "Role removed successfully.");
});

export default {
  createRole,
  getServerRoles,
  getRole,
  updateRole,
  deleteRole,
  reorderRoles,
  assignRole,
  removeRole,
};