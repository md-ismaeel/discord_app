import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { RoleModel } from "../models/role.model.js";
import { ServerModel } from "../models/server.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToServer } from "../socket/socketHandler.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { validateObjectId } from "../utils/validateObjId.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberRole = "owner" | "admin" | "moderator" | "member";

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL = { ROLES: 900, ROLE: 900 } as const;

const getCacheKey = {
  serverRoles: (serverId: string): string => `server:${serverId}:roles`,
  role: (roleId: string): string => `role:${roleId}`,
};

const invalidateRoleCache = async (
  serverId: string,
  roleId: string | null = null,
): Promise<void> => {
  const keys: string[] = [getCacheKey.serverRoles(serverId), `server:${serverId}`];
  if (roleId) keys.push(getCacheKey.role(roleId));
  await pubClient.del(...keys);
};

// ─── Permission helper ────────────────────────────────────────────────────────

const checkMemberPermission = async (
  serverId: string,
  userId: string,
  requiredRoles: MemberRole[] = ["owner", "admin"],
) => {
  const membership = await ServerMemberModel.findOne({ server: serverId, user: userId });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  if (!requiredRoles.includes(membership.role as MemberRole)) {
    throw ApiError.forbidden(`Only ${requiredRoles.join(", ")} can perform this action.`);
  }

  return membership;
};

// ─── Create role ──────────────────────────────────────────────────────────────

export const createRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const { name, color, permissions } = req.body as {
    name: string;
    color?: string;
    permissions?: Record<string, boolean>;
  };
  const userId = validateObjectId(req.user._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const duplicate = await RoleModel.findOne({ server: serverId, name });
  if (duplicate) throw ApiError.conflict("A role with this name already exists in this server.");

  const highest = await RoleModel.findOne({ server: serverId }).sort({ position: -1 }).lean();
  const position = highest ? highest.position + 1 : 0;

  const role = await RoleModel.create({
    name,
    color: color ?? "#99AAB5",
    server: serverId,
    permissions: permissions ?? {},
    position,
  });

  await invalidateRoleCache(serverId);

  emitToServer(serverId, "role:created", { role, createdBy: userId, timestamp: new Date() });

  sendCreated(res, role, "Role created successfully.");
});

// ─── Get server roles ─────────────────────────────────────────────────────────

export const getServerRoles = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin", "moderator", "member"]);

  const cacheKey = getCacheKey.serverRoles(serverId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const roles = await RoleModel.find({ server: serverId }).sort({ position: -1 }).lean();

  await pubClient.setex(cacheKey, CACHE_TTL.ROLES, JSON.stringify(roles));

  sendSuccess(res, roles, "Roles fetched successfully.");
});

// ─── Get single role ──────────────────────────────────────────────────────────

export const getRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  const cacheKey = getCacheKey.role(roleId);
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const role = JSON.parse(cached);
    await checkMemberPermission(role.server.toString(), userId, [
      "owner", "admin", "moderator", "member",
    ]);
    return sendSuccess(res, role);
  }

  const role = await RoleModel.findById(roleId).lean();
  if (!role) throw ApiError.notFound("Role not found.");

  await checkMemberPermission(role.server.toString(), userId, [
    "owner", "admin", "moderator", "member",
  ]);

  await pubClient.setex(cacheKey, CACHE_TTL.ROLE, JSON.stringify(role));

  sendSuccess(res, role);
});

// ─── Update role ──────────────────────────────────────────────────────────────

export const updateRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { roleId } = req.params;
  const { name, color, permissions, position } = req.body as {
    name?: string;
    color?: string;
    permissions?: Record<string, boolean>;
    position?: number;
  };
  const userId = validateObjectId(req.user._id);

  const role = await RoleModel.findById(roleId);
  if (!role) throw ApiError.notFound("Role not found.");

  await checkMemberPermission(role.server.toString(), userId, ["owner", "admin"]);

  // Protect default role's core permissions
  let safePermissions = permissions;
  if (role.isDefault && permissions) {
    safePermissions = {
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
  if (safePermissions !== undefined) {
    role.permissions = { ...role.permissions.toObject?.() ?? role.permissions, ...safePermissions };
  }
  if (position !== undefined) role.position = position;

  await role.save();
  await invalidateRoleCache(role.server.toString(), roleId);

  emitToServer(role.server.toString(), "role:updated", { role, updatedBy: userId, timestamp: new Date() });

  sendSuccess(res, role, "Role updated successfully.");
});

// ─── Delete role ──────────────────────────────────────────────────────────────

export const deleteRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  const role = await RoleModel.findById(roleId);
  if (!role) throw ApiError.notFound("Role not found.");

  if (role.isDefault) throw ApiError.badRequest("Cannot delete the default role.");

  await checkMemberPermission(role.server.toString(), userId, ["owner", "admin"]);

  const serverId = role.server.toString();

  await ServerMemberModel.updateMany(
    { server: serverId, roles: roleId },
    { $pull: { roles: roleId } },
  );

  await role.deleteOne();
  await invalidateRoleCache(serverId, roleId);

  emitToServer(serverId, "role:deleted", { roleId, deletedBy: userId, timestamp: new Date() });

  sendSuccess(res, null, "Role deleted successfully.");
});

// ─── Reorder roles ────────────────────────────────────────────────────────────

export const reorderRoles = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const { roleOrder } = req.body as {
    roleOrder: Array<{ roleId: string; position: number }>;
  };
  const userId = validateObjectId(req.user._id);

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

  const roles = await RoleModel.find({ server: serverId }).sort({ position: -1 }).lean();

  await invalidateRoleCache(serverId);

  emitToServer(serverId, "roles:reordered", { roles, reorderedBy: userId, timestamp: new Date() });

  sendSuccess(res, roles, "Roles reordered successfully.");
});

// ─── Assign role to member ────────────────────────────────────────────────────

export const assignRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId, memberId, roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const role = await RoleModel.findOne({ _id: roleId, server: serverId });
  if (!role) throw ApiError.notFound("Role not found in this server.");

  const member = await ServerMemberModel.findOne({ server: serverId, user: memberId });
  if (!member) throw ApiError.notFound("Member not found in this server.");

  if (!member.roles) member.roles = [];

  // FIX: original used Array.includes on an ObjectId array — must compare as strings
  if (member.roles.some((id) => id.toString() === roleId)) {
    throw ApiError.badRequest("Member already has this role.");
  }

  member.roles.push(roleId as unknown as Types.ObjectId);
  await member.save();

  const populated = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  await Promise.all([invalidateRoleCache(serverId), pubClient.del(`server:${serverId}`)]);

  emitToServer(serverId, "member:roleAssigned", {
    member: populated,
    role,
    assignedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, populated, "Role assigned successfully.");
});

// ─── Remove role from member ──────────────────────────────────────────────────

export const removeRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId, memberId, roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  const member = await ServerMemberModel.findOne({ server: serverId, user: memberId });
  if (!member) throw ApiError.notFound("Member not found in this server.");

  // FIX: same ObjectId string comparison fix
  if (!member.roles?.some((id) => id.toString() === roleId)) {
    throw ApiError.badRequest("Member doesn't have this role.");
  }

  member.roles = member.roles.filter((id) => id.toString() !== roleId);
  await member.save();

  const populated = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  await Promise.all([invalidateRoleCache(serverId), pubClient.del(`server:${serverId}`)]);

  emitToServer(serverId, "member:roleRemoved", {
    member: populated,
    roleId,
    removedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, populated, "Role removed successfully.");
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