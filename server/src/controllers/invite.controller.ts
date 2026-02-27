import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { InviteModel } from "../models/invite.model.js";
import { ServerModel } from "../models/server.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { RoleModel } from "../models/role.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToServer, emitToUser } from "../socket/socketHandler.js";
import crypto from "crypto";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { validateObjectId } from "../utils/validateObjId.js";

const CACHE_TTL = {
  INVITE: 1800, // 30 minutes
  SERVER_INVITES: 600, // 10 minutes
};

const getCacheKey = {
  invite: (code) => `invite:${code}`,
  serverInvites: (serverId) => `server:${serverId}:invites`,
};

const invalidateInviteCache = async (serverId, code = null) => {
  const keys = [getCacheKey.serverInvites(serverId), `server:${serverId}`];

  if (code) {
    keys.push(getCacheKey.invite(code));
  }

  await pubClient.del(...keys);
};

// Generate unique invite code
const generateInviteCode = () => {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
};

// Helper to check member permissions
const checkMemberPermission = async (serverId, userId) => {
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

  return membership;
};

//    Create server invite
export const createInvite = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { maxUses, expiresIn } = req.body; // expiresIn in hours
  const userId = validateObjectId(req.user._id);

  // Verify server exists
  const server = await ServerModel.findById(serverId);
  if (!server) {
    throw createApiError(
      HTTP_STATUS.NOT_FOUND,
      ERROR_MESSAGES.SERVER_NOT_FOUND,
    );
  }

  // Check if user is a member
  await checkMemberPermission(serverId, userId);

  // TODO: Check if user has createInvite permission via Role model
  // For now, all members can create invites

  // Generate unique code
  let code;
  let isUnique = false;
  while (!isUnique) {
    code = generateInviteCode();
    const existing = await InviteModel.findOne({ code });
    if (!existing) {
      isUnique = true;
    }
  }

  // Calculate expiration
  let expiresAt = null;
  if (expiresIn) {
    expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(expiresIn));
  }

  // Create invite
  const invite = await InviteModel.create({
    code,
    server: serverId,
    inviter: userId,
    maxUses: maxUses || null,
    expiresAt,
  });

  // Add to server's invites array
  await ServerModel.findByIdAndUpdate(serverId, {
    $push: { invites: invite._id },
  });

  const populatedInvite = await InviteModel.findById(invite._id)
    .populate("server", "name icon")
    .populate("inviter", "username avatar")
    .lean();

  // Invalidate cache
  await invalidateInviteCache(serverId, code);

  sendCreated(res, populatedInvite, "Invite created successfully");
});

//    Get invite details by code
export const getInvite = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const cacheKey = getCacheKey.invite(code);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const invite = JSON.parse(cached);

    // Check if expired or max uses reached
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw createApiError(410, "Invite has expired");
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) {
      throw createApiError(410, "Invite has reached maximum uses");
    }

    return sendSuccess(res, invite);
  }

  const invite = await InviteModel.findOne({ code })
    .populate("server", "name description icon banner memberCount isPublic")
    .populate("inviter", "username avatar")
    .lean();

  if (!invite) {
    throw createApiError(404, "Invite not found");
  }

  // Check if expired
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await InviteModel.findByIdAndDelete(invite._id);
    throw createApiError(410, "Invite has expired");
  }

  // Check if max uses reached
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw createApiError(410, "Invite has reached maximum uses");
  }

  // Add member count to server info
  const memberCount = await ServerMemberModel.countDocuments({
    server: invite.server._id,
  });
  invite.server.memberCount = memberCount;

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.INVITE, JSON.stringify(invite));

  sendSuccess(res, invite);
});

//    Join server using invite code
export const joinServerWithInvite = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const userId = validateObjectId(req.user._id);

  const invite = await InviteModel.findOne({ code });

  if (!invite) {
    throw createApiError(404, "Invite not found");
  }

  // Check if expired
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await InviteModel.findByIdAndDelete(invite._id);
    throw createApiError(410, "Invite has expired");
  }

  // Check if max uses reached
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw createApiError(410, "Invite has reached maximum uses");
  }

  // Check if already a member
  const existingMember = await ServerMemberModel.findOne({
    server: invite.server,
    user: userId,
  });

  if (existingMember) {
    throw createApiError(400, "You are already a member of this server");
  }

  // Get server
  const server = await ServerModel.findById(invite.server);
  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Get default role for new members
  const defaultRole = await RoleModel.findOne({
    server: invite.server,
    isDefault: true,
  });

  // Create server member
  const member = await ServerMemberModel.create({
    user: userId,
    server: invite.server,
    role: "member",
    roles: defaultRole ? [defaultRole._id] : [],
  });

  // Add to server's members array
  server.members.push(member._id);
  await server.save();

  // Increment invite uses
  invite.uses += 1;
  await invite.save();

  // If max uses reached, optionally delete the invite
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    await InviteModel.findByIdAndDelete(invite._id);
  }

  // Invalidate caches
  await Promise.all([
    invalidateInviteCache(invite.server.toString(), code),
    pubClient.del(`user:${userId}:servers`),
  ]);

  // Populate member details
  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .lean();

  // Emit socket event to server
  emitToServer(invite.server.toString(), "member:joined", {
    member: populatedMember,
    server: {
      _id: server._id,
      name: server.name,
      icon: server.icon,
    },
    timestamp: new Date(),
  });

  // Emit to user
  emitToUser(userId, "server:joined", {
    server: {
      _id: server._id,
      name: server.name,
      icon: server.icon,
      description: server.description,
    },
    timestamp: new Date(),
  });

  const response = {
    server: await ServerModel.findById(invite.server)
      .populate("owner", "username avatar")
      .populate("channels")
      .lean(),
    member: populatedMember,
  };

  sendSuccess(res, response, "Successfully joined server");
});

//    Get all invites for a server
export const getServerInvites = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  // Check permissions
  const membership = await checkMemberPermission(serverId, userId);

  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw createApiError(
      403,
      "Only admins and moderators can view server invites",
    );
  }

  const cacheKey = getCacheKey.serverInvites(serverId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const invites = await InviteModel.find({ server: serverId })
    .populate("inviter", "username avatar")
    .sort({ createdAt: -1 })
    .lean();

  // Remove expired invites
  const now = new Date();
  const validInvites = invites.filter((invite) => {
    if (invite.expiresAt && new Date(invite.expiresAt) < now) {
      InviteModel.findByIdAndDelete(invite._id);
      return false;
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) {
      return false;
    }
    return true;
  });

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.SERVER_INVITES,
    JSON.stringify(validInvites),
  );

  sendSuccess(res, validInvites);
});

//    Delete/Revoke an invite
export const deleteInvite = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const userId = validateObjectId(req.user._id);

  const invite = await InviteModel.findOne({ code });

  if (!invite) {
    throw createApiError(404, "Invite not found");
  }

  // Check permissions - must be inviter, admin, or owner
  const membership = await ServerMemberModel.findOne({
    server: invite.server,
    user: userId,
  });

  if (!membership) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  const isInviter = invite.inviter.toString() === userId;
  const isAdmin = ["owner", "admin", "moderator"].includes(membership.role);

  if (!isInviter && !isAdmin) {
    throw createApiError(
      403,
      "You don't have permission to delete this invite",
    );
  }

  const serverId = invite.server.toString();

  // Remove from server's invites array
  await ServerModel.findByIdAndUpdate(serverId, {
    $pull: { invites: invite._id },
  });

  await invite.deleteOne();

  // Invalidate cache
  await invalidateInviteCache(serverId, code);

  sendSuccess(res, null, "Invite deleted successfully");
});

//    Clean up expired invites (can be called by a cron job)
export const cleanupExpiredInvites = asyncHandler(async (req, res) => {
  const now = new Date();

  // Find and delete expired invites
  const expiredInvites = await InviteModel.find({
    expiresAt: { $lt: now },
  });

  const serverIds = new Set();

  for (const invite of expiredInvites) {
    serverIds.add(invite.server.toString());

    // Remove from server's invites array
    await ServerModel.findByIdAndUpdate(invite.server, {
      $pull: { invites: invite._id },
    });

    await invite.deleteOne();
  }

  // Invalidate caches for affected servers
  for (const serverId of serverIds) {
    await invalidateInviteCache(serverId);
  }

  sendSuccess(
    res,
    {
      deletedCount: expiredInvites.length,
    },
    "Expired invites cleaned up successfully",
  );
});

export default {
  createInvite,
  getInvite,
  joinServerWithInvite,
  getServerInvites,
  deleteInvite,
  cleanupExpiredInvites,
};
