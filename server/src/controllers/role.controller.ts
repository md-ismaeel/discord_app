import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { RoleModel } from "../models/role.model.js";
import { ServerModel } from "../models/server.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToServer } from "../socket/socketHandler.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { validateObjectId } from "../utils/validateObjId.js";

const CACHE_TTL = {
  ROLES: 900, // 15 minutes
  ROLE: 900, // 15 minutes
};

const getCacheKey = {
  serverRoles: (serverId) => `server:${serverId}:roles`,
  role: (roleId) => `role:${roleId}`,
};

const invalidateRoleCache = async (serverId, roleId = null) => {
  const keys = [getCacheKey.serverRoles(serverId), `server:${serverId}`];

  if (roleId) {
    keys.push(getCacheKey.role(roleId));
  }

  await pubClient.del(...keys);
};

// Helper to check member permissions
const checkMemberPermission = async (
  serverId,
  userId,
  requiredRole = ["owner", "admin"],
) => {
  const membership = await ServerMemberModel.findOne({
    server: serverId,
    user: userId,
  });

  if (!membership) {
    throw createApiError(
      HTTP_STATUS.FORBIDDEN,
      ERROR_MESSAGES.NOT_SERVER_MEMBER,
    );
  }

  if (!requiredRole.includes(membership.role)) {
    throw createApiError(
      HTTP_STATUS.FORBIDDEN,
      `Only ${requiredRole.join(", ")} can perform this action`,
    );
  }

  return membership;
};

//    Create a new role
export const createRole = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { name, color, permissions } = req.body;
  const userId = validateObjectId(req.user._id);

  // Check permissions
  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  // Verify server exists
  const server = await ServerModel.findById(serverId);
  if (!server) {
    throw createApiError(
      HTTP_STATUS.NOT_FOUND,
      ERROR_MESSAGES.SERVER_NOT_FOUND,
    );
  }

  // Check for duplicate role name in the same server
  const existingRole = await RoleModel.findOne({
    server: serverId,
    name: name,
  });

  if (existingRole) {
    throw createApiError(
      400,
      "A role with this name already exists in this server",
    );
  }

  // Get highest position for new role
  const highestRole = await RoleModel.findOne({ server: serverId })
    .sort({ position: -1 })
    .lean();

  const position = highestRole ? highestRole.position + 1 : 0;

  // Create role
  const role = await RoleModel.create({
    name,
    color: color || "#99AAB5",
    server: serverId,
    permissions: permissions || {},
    position,
  });

  // Invalidate cache
  await invalidateRoleCache(serverId);

  // Emit socket event
  emitToServer(serverId, "role:created", {
    role,
    createdBy: userId,
    timestamp: new Date(),
  });

  sendCreated(res, role, "Role created successfully");
});

//    Get all roles in a server
export const getServerRoles = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  // Check if user is a member
  await checkMemberPermission(serverId, userId, [
    "owner",
    "admin",
    "moderator",
    "member",
  ]);

  const cacheKey = getCacheKey.serverRoles(serverId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const roles = await RoleModel.find({ server: serverId })
    .sort({ position: -1 }) // Highest position first (most powerful)
    .lean();

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.ROLES, JSON.stringify(roles));

  sendSuccess(res, roles, "Roles fetched successfully");
});

//    Get a single role by ID
export const getRole = asyncHandler(async (req, res) => {
  const { roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  const cacheKey = getCacheKey.role(roleId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const role = JSON.parse(cached);

    // Verify user has access
    await checkMemberPermission(role.server.toString(), userId, [
      "owner",
      "admin",
      "moderator",
      "member",
    ]);

    return sendSuccess(res, role);
  }

  const role = await RoleModel.findById(roleId).lean();

  if (!role) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, "Role not found");
  }

  // Check if user is a server member
  await checkMemberPermission(role.server.toString(), userId, [
    "owner",
    "admin",
    "moderator",
    "member",
  ]);

  // Cache the role
  await pubClient.setex(cacheKey, CACHE_TTL.ROLE, JSON.stringify(role));

  sendSuccess(res, role);
});

//    Update a role
export const updateRole = asyncHandler(async (req, res) => {
  const { roleId } = req.params;
  const { name, color, permissions, position } = req.body;
  const userId = validateObjectId(req.user._id);

  const role = await RoleModel.findById(roleId);

  if (!role) {
    throw createApiError(404, "Role not found");
  }

  // Check permissions
  await checkMemberPermission(role.server.toString(), userId, [
    "owner",
    "admin",
  ]);

  // Cannot modify default role's basic permissions
  if (role.isDefault && permissions) {
    // Ensure default role keeps basic permissions
    permissions.readMessages = true;
    permissions.sendMessages = true;
    permissions.connect = true;
    permissions.speak = true;
  }

  // Check for duplicate name if name is being changed
  if (name && name !== role.name) {
    const existingRole = await RoleModel.findOne({
      server: role.server,
      name: name,
      _id: { $ne: roleId },
    });

    if (existingRole) {
      throw createApiError(
        400,
        "A role with this name already exists in this server",
      );
    }
    role.name = name;
  }

  // Update fields
  if (color !== undefined) role.color = color;
  if (permissions !== undefined) {
    role.permissions = { ...role.permissions, ...permissions };
  }
  if (position !== undefined) role.position = position;

  await role.save();

  // Invalidate caches
  await invalidateRoleCache(role.server.toString(), roleId);

  // Emit socket event
  emitToServer(role.server.toString(), "role:updated", {
    role,
    updatedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, role, "Role updated successfully");
});

//    Delete a role
export const deleteRole = asyncHandler(async (req, res) => {
  const { roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  const role = await RoleModel.findById(roleId);

  if (!role) {
    throw createApiError(404, "Role not found");
  }

  // Cannot delete default role
  if (role.isDefault) {
    throw createApiError(400, "Cannot delete the default role");
  }

  // Check permissions (only owner and admin can delete)
  await checkMemberPermission(role.server.toString(), userId, [
    "owner",
    "admin",
  ]);

  const serverId = role.server.toString();

  // Remove role from all members who have it
  await ServerMemberModel.updateMany(
    { server: serverId, roles: roleId },
    { $pull: { roles: roleId } },
  );

  // Delete the role
  await role.deleteOne();

  // Invalidate caches
  await invalidateRoleCache(serverId, roleId);

  // Emit socket event
  emitToServer(serverId, "role:deleted", {
    roleId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Role deleted successfully");
});

//    Reorder roles
export const reorderRoles = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { roleOrder } = req.body; // Array of { roleId, position }
  const userId = validateObjectId(req.user._id);

  // Validate request body
  if (!Array.isArray(roleOrder) || roleOrder.length === 0) {
    throw createApiError(400, "roleOrder must be a non-empty array");
  }

  // Check permissions
  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  // Update positions in bulk
  const bulkOps = roleOrder.map(({ roleId, position }) => ({
    updateOne: {
      filter: { _id: roleId, server: serverId },
      update: { $set: { position } },
    },
  }));

  await RoleModel.bulkWrite(bulkOps);

  // Get updated roles
  const roles = await RoleModel.find({ server: serverId })
    .sort({ position: -1 })
    .lean();

  // Invalidate cache
  await invalidateRoleCache(serverId);

  // Emit socket event
  emitToServer(serverId, "roles:reordered", {
    roles,
    reorderedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, roles, "Roles reordered successfully");
});

//    Assign role to a member
export const assignRole = asyncHandler(async (req, res) => {
  const { serverId, memberId, roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  // Check permissions
  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  // Verify role exists and belongs to this server
  const role = await RoleModel.findOne({ _id: roleId, server: serverId });
  if (!role) {
    throw createApiError(404, "Role not found in this server");
  }

  // Find the member
  const member = await ServerMemberModel.findOne({
    server: serverId,
    user: memberId,
  });

  if (!member) {
    throw createApiError(404, "Member not found in this server");
  }

  // Check if member already has this role
  if (!member.roles) {
    member.roles = [];
  }

  if (member.roles.includes(roleId)) {
    throw createApiError(400, "Member already has this role");
  }

  // Add role
  member.roles.push(roleId);
  await member.save();

  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  // Invalidate caches
  await Promise.all([
    invalidateRoleCache(serverId),
    pubClient.del(`server:${serverId}`),
  ]);

  // Emit socket event
  emitToServer(serverId, "member:roleAssigned", {
    member: populatedMember,
    role,
    assignedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, populatedMember, "Role assigned successfully");
});

//    Remove role from a member
export const removeRole = asyncHandler(async (req, res) => {
  const { serverId, memberId, roleId } = req.params;
  const userId = validateObjectId(req.user._id);

  // Check permissions
  await checkMemberPermission(serverId, userId, ["owner", "admin"]);

  // Find the member
  const member = await ServerMemberModel.findOne({
    server: serverId,
    user: memberId,
  });

  if (!member) {
    throw createApiError(404, "Member not found in this server");
  }

  // Check if member has this role
  if (!member.roles || !member.roles.includes(roleId)) {
    throw createApiError(400, "Member doesn't have this role");
  }

  // Remove role
  member.roles = member.roles.filter((id) => id.toString() !== roleId);
  await member.save();

  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .populate("roles")
    .lean();

  // Invalidate caches
  await Promise.all([
    invalidateRoleCache(serverId),
    pubClient.del(`server:${serverId}`),
  ]);

  // Emit socket event
  emitToServer(serverId, "member:roleRemoved", {
    member: populatedMember,
    roleId,
    removedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, populatedMember, "Role removed successfully");
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
