import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL = {
  INVITE: 1800,
  SERVER_INVITES: 600,
} as const;

const getCacheKey = {
  invite: (code: string): string => `invite:${code}`,
  serverInvites: (serverId: string): string => `server:${serverId}:invites`,
};

const invalidateInviteCache = async (
  serverId: string,
  code: string | null = null,
): Promise<void> => {
  const keys: string[] = [getCacheKey.serverInvites(serverId), `server:${serverId}`];
  if (code) keys.push(getCacheKey.invite(code));
  await pubClient.del(...keys);
};

// ─── Generate invite code ─────────────────────────────────────────────────────

const generateInviteCode = (): string =>
  crypto.randomBytes(4).toString("hex").toUpperCase();

// ─── Permission helper ────────────────────────────────────────────────────────

const checkMemberPermission = async (serverId: string, userId: string) => {
  const membership = await ServerMemberModel.findOne({ server: serverId, user: userId });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
  return membership;
};

// ─── Create invite ────────────────────────────────────────────────────────────

export const createInvite = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const { maxUses, expiresIn } = req.body as {
    maxUses?: number;
    expiresIn?: number | string; // hours
  };
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  await checkMemberPermission(serverId, userId);

  // Generate unique code (collision-resistant loop)
  let code: string;
  do {
    code = generateInviteCode();
  } while (await InviteModel.exists({ code }));

  let expiresAt: Date | null = null;
  if (expiresIn) {
    expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(String(expiresIn), 10));
  }

  const invite = await InviteModel.create({
    code,
    server: serverId,
    inviter: userId,
    maxUses: maxUses ?? null,
    expiresAt,
  });

  await ServerModel.findByIdAndUpdate(serverId, { $push: { invites: invite._id } });

  const populated = await InviteModel.findById(invite._id)
    .populate("server", "name icon")
    .populate("inviter", "username avatar")
    .lean();

  await invalidateInviteCache(serverId, code);

  sendCreated(res, populated, "Invite created successfully.");
});

// ─── Get invite by code ───────────────────────────────────────────────────────

export const getInvite = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params;
  const cacheKey = getCacheKey.invite(code);

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const invite = JSON.parse(cached);
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      throw ApiError.gone("Invite has expired.");
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) {
      throw ApiError.gone("Invite has reached maximum uses.");
    }
    return sendSuccess(res, invite);
  }

  const invite = await InviteModel.findOne({ code })
    .populate("server", "name description icon banner memberCount isPublic")
    .populate("inviter", "username avatar")
    .lean();

  if (!invite) throw ApiError.notFound("Invite not found.");

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await InviteModel.findByIdAndDelete(invite._id);
    throw ApiError.gone("Invite has expired.");
  }
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw ApiError.gone("Invite has reached maximum uses.");
  }

  // Attach live member count
  const memberCount = await ServerMemberModel.countDocuments({
    server: (invite.server as { _id: Types.ObjectId })._id,
  });
  (invite.server as Record<string, unknown>).memberCount = memberCount;

  await pubClient.setex(cacheKey, CACHE_TTL.INVITE, JSON.stringify(invite));

  sendSuccess(res, invite);
});

// ─── Join server with invite ──────────────────────────────────────────────────

export const joinServerWithInvite = asyncHandler(async (req: AuthReq, res: Response) => {
  const { code } = req.params;
  const userId = validateObjectId(req.user._id);

  const invite = await InviteModel.findOne({ code });
  if (!invite) throw ApiError.notFound("Invite not found.");

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await invite.deleteOne();
    throw ApiError.gone("Invite has expired.");
  }
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw ApiError.gone("Invite has reached maximum uses.");
  }

  const alreadyMember = await ServerMemberModel.exists({
    server: invite.server,
    user: userId,
  });
  if (alreadyMember) throw ApiError.badRequest("You are already a member of this server.");

  const server = await ServerModel.findById(invite.server);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const defaultRole = await RoleModel.findOne({ server: invite.server, isDefault: true });

  const member = await ServerMemberModel.create({
    user: userId,
    server: invite.server,
    role: "member",
    roles: defaultRole ? [defaultRole._id] : [],
  });

  server.members.push(member._id);
  await server.save();

  invite.uses += 1;
  await invite.save();

  // Clean up exhausted invite
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    await invite.deleteOne();
  }

  const serverId = invite.server.toString();

  await Promise.all([
    invalidateInviteCache(serverId, code),
    pubClient.del(`user:${userId}:servers`),
  ]);

  const populatedMember = await ServerMemberModel.findById(member._id)
    .populate("user", "username avatar status")
    .lean();

  emitToServer(serverId, "member:joined", {
    member: populatedMember,
    server: { _id: server._id, name: server.name, icon: server.icon },
    timestamp: new Date(),
  });

  emitToUser(userId, "server:joined", {
    server: {
      _id: server._id,
      name: server.name,
      icon: server.icon,
      description: server.description,
    },
    timestamp: new Date(),
  });

  const fullServer = await ServerModel.findById(invite.server)
    .populate("owner", "username avatar")
    .populate("channels")
    .lean();

  sendSuccess(res, { server: fullServer, member: populatedMember }, "Successfully joined server.");
});

// ─── Get server invites ───────────────────────────────────────────────────────

export const getServerInvites = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  const membership = await checkMemberPermission(serverId, userId);
  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw ApiError.forbidden("Only admins and moderators can view server invites.");
  }

  const cacheKey = getCacheKey.serverInvites(serverId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const invites = await InviteModel.find({ server: serverId })
    .populate("inviter", "username avatar")
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();

  // FIX: original called InviteModel.findByIdAndDelete inside .filter() without await
  // — fire-and-forget deletions in a sync filter are never awaited. Do it properly.
  const expiredIds: Types.ObjectId[] = [];
  const validInvites = invites.filter((invite) => {
    if (invite.expiresAt && new Date(invite.expiresAt) < now) {
      expiredIds.push(invite._id as Types.ObjectId);
      return false;
    }
    if (invite.maxUses && invite.uses >= invite.maxUses) return false;
    return true;
  });

  if (expiredIds.length > 0) {
    await InviteModel.deleteMany({ _id: { $in: expiredIds } });
  }

  await pubClient.setex(cacheKey, CACHE_TTL.SERVER_INVITES, JSON.stringify(validInvites));

  sendSuccess(res, validInvites);
});

// ─── Delete invite ────────────────────────────────────────────────────────────

export const deleteInvite = asyncHandler(async (req: AuthReq, res: Response) => {
  const { code } = req.params;
  const userId = validateObjectId(req.user._id);

  const invite = await InviteModel.findOne({ code });
  if (!invite) throw ApiError.notFound("Invite not found.");

  const membership = await ServerMemberModel.findOne({
    server: invite.server,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  const isInviter = invite.inviter.toString() === userId;
  const isAdmin = ["owner", "admin", "moderator"].includes(membership.role);

  if (!isInviter && !isAdmin) {
    throw ApiError.forbidden("You don't have permission to delete this invite.");
  }

  const serverId = invite.server.toString();

  await ServerModel.findByIdAndUpdate(serverId, { $pull: { invites: invite._id } });
  await invite.deleteOne();
  await invalidateInviteCache(serverId, code);

  sendSuccess(res, null, "Invite deleted successfully.");
});

// ─── Cleanup expired invites (cron-callable) ──────────────────────────────────

export const cleanupExpiredInvites = asyncHandler(async (_req: Request, res: Response) => {
  const expired = await InviteModel.find({ expiresAt: { $lt: new Date() } });

  const serverIds = new Set<string>();

  // FIX: original iterated with per-document awaits — batch the deletes instead
  const inviteIds = expired.map((inv) => {
    serverIds.add(inv.server.toString());
    return inv._id;
  });

  await InviteModel.deleteMany({ _id: { $in: inviteIds } });

  // Remove from server arrays in parallel
  await Promise.all(
    [...serverIds].map((serverId) =>
      ServerModel.updateMany(
        { _id: serverId },
        { $pull: { invites: { $in: inviteIds } } },
      ),
    ),
  );

  await Promise.all([...serverIds].map((sid) => invalidateInviteCache(sid)));

  sendSuccess(res, { deletedCount: expired.length }, "Expired invites cleaned up successfully.");
});

export default {
  createInvite,
  getInvite,
  joinServerWithInvite,
  getServerInvites,
  deleteInvite,
  cleanupExpiredInvites,
};