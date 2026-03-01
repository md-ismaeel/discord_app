import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import type { IInvite, IServer, IServerMember } from "@/types/models";
import { InviteModel } from "@/models/invite.model";
import { ServerModel } from "@/models/server.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { RoleModel } from "@/models/role.model";
import { pubClient } from "@/config/redis.config";
import { emitToServer, emitToUser } from "@/socket/socketHandler";
import crypto from "crypto";
import { validateObjectId } from "@/utils/validateObjId";

// ─── Cache helpers
const CACHE_TTL = { INVITE: 1800, SERVER_INVITES: 600 } as const;

const getCacheKey = {
  invite: (code: string) => `invite:${code}`,
  serverInvites: (sid: string) => `server:${sid}:invites`,
};

const invalidateInviteCache = async (serverId: string, code?: string): Promise<void> => {
  const keys = [getCacheKey.serverInvites(serverId), `server:${serverId}`];
  if (code) keys.push(getCacheKey.invite(code));
  await pubClient.del(...keys);
};

// ─── Helpers 
const generateCode = (): string =>
  crypto.randomBytes(4).toString("hex").toUpperCase();

const checkMembership = async (serverId: string, userId: string): Promise<IServerMember> => {
  const m = await ServerMemberModel.findOne<IServerMember>({ server: serverId, user: userId });
  if (!m) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
  return m;
};

// ─── Create invite
export const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const { maxUses, expiresIn } = req.body as {
    maxUses?: number;
    expiresIn?: number | string; // hours
  };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById<IServer>(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  await checkMembership(serverId, userId);

  // Collision-safe loop — IInvite.code is unique
  let code: string;
  do {
    code = generateCode();
  } while (await InviteModel.exists({ code }));

  let expiresAt: Date | undefined;
  if (expiresIn) {
    expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(String(expiresIn), 10));
  }

  const invite = await InviteModel.create({
    code,
    server: serverId,
    inviter: userId,
    // IInvite.maxUses?: number
    maxUses: maxUses ?? undefined,
    expiresAt,
  });

  await ServerModel.findByIdAndUpdate(serverId, { $push: { invites: invite._id } });

  const populated = await InviteModel.findById<IInvite>(invite._id)
    .populate("server", "name icon")
    .populate("inviter", "username avatar")
    .lean();

  await invalidateInviteCache(serverId, code);

  sendCreated(res, populated, "Invite created successfully.");
});

// ─── Get invite by code 
export const getInvite = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const cacheKey = getCacheKey.invite(code);

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const inv = JSON.parse(cached) as IInvite;
    // IInvite.expiresAt?: Date
    if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      throw ApiError.gone("Invite has expired.");
    }
    // IInvite.maxUses?: number, IInvite.uses: number
    if (inv.maxUses && inv.uses >= inv.maxUses) {
      throw ApiError.gone("Invite has reached its maximum uses.");
    }
    return sendSuccess(res, inv);
  }

  const invite = await InviteModel.findOne<IInvite>({ code })
    .populate("server", "name description icon banner isPublic")
    .populate("inviter", "username avatar")
    .lean();

  if (!invite) throw ApiError.notFound("Invite not found.");

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await InviteModel.findByIdAndDelete(invite._id);
    throw ApiError.gone("Invite has expired.");
  }
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw ApiError.gone("Invite has reached its maximum uses.");
  }

  // Attach live member count (not stored on invite)
  const memberCount = await ServerMemberModel.countDocuments({
    server: (invite.server as unknown as IServer)._id,
  });
  (invite.server as unknown as Record<string, unknown>).memberCount = memberCount;

  await pubClient.setex(cacheKey, CACHE_TTL.INVITE, JSON.stringify(invite));

  return sendSuccess(res, invite, "Invite fetched successfully.");
});

// ─── Join server with invite 
export const joinServerWithInvite = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const userId = validateObjectId(req.user!._id);

  const invite = await InviteModel.findOne<IInvite>({ code });
  if (!invite) throw ApiError.notFound("Invite not found.");

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await invite.deleteOne();
    throw ApiError.gone("Invite has expired.");
  }
  if (invite.maxUses && invite.uses >= invite.maxUses) {
    throw ApiError.gone("Invite has reached its maximum uses.");
  }

  const already = await ServerMemberModel.exists({ server: invite.server, user: userId });
  if (already) throw ApiError.badRequest("You are already a member of this server.");

  const server = await ServerModel.findById<IServer>(invite.server);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const defaultRole = await RoleModel.findOne({ server: invite.server, isDefault: true });

  const member = await ServerMemberModel.create({
    user: userId,
    server: invite.server,
    role: "member",
    roles: defaultRole ? [defaultRole._id] : [],
  });

  // IServer.members: Types.ObjectId[]
  server.members.push(member._id);
  await server.save();

  // IInvite.uses: number
  invite.uses += 1;
  await invite.save();

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
    .lean<IServer>();

  sendSuccess(res, { server: fullServer, member: populatedMember }, "Successfully joined server.");
});

// ─── Get server invites
export const getServerInvites = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  // IServerMember.role: "owner" | "admin" | "moderator" | "member"
  const membership = await checkMembership(serverId, userId);
  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw ApiError.forbidden("Only admins and moderators can view server invites.");
  }

  const cacheKey = getCacheKey.serverInvites(serverId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const invites = await InviteModel.find<IInvite>({ server: serverId })
    .populate("inviter", "username avatar")
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();

  // Collect expired IDs then batch delete — avoids fire-and-forget in .filter()
  const expiredIds: Types.ObjectId[] = [];
  const valid = invites.filter((inv) => {
    if (inv.expiresAt && new Date(inv.expiresAt) < now) {
      expiredIds.push(inv._id as Types.ObjectId);
      return false;
    }
    if (inv.maxUses && inv.uses >= inv.maxUses) return false;
    return true;
  });

  if (expiredIds.length > 0) {
    await InviteModel.deleteMany({ _id: { $in: expiredIds } });
  }

  await pubClient.setex(cacheKey, CACHE_TTL.SERVER_INVITES, JSON.stringify(valid));

  return sendSuccess(res, valid, "Server invites fetched successfully.");
});

// ─── Delete / revoke invite
export const deleteInvite = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  const userId = validateObjectId(req.user!._id);

  const invite = await InviteModel.findOne<IInvite>({ code });
  if (!invite) throw ApiError.notFound("Invite not found.");

  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: invite.server,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  // IInvite.inviter: Types.ObjectId
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

// ─── Cleanup expired invites (cron endpoint)
export const cleanupExpiredInvites = asyncHandler(async (_req: Request, res: Response) => {
  const expired = await InviteModel.find<IInvite>({ expiresAt: { $lt: new Date() } });

  if (expired.length === 0) {
    return sendSuccess(res, { deletedCount: 0 }, "No expired invites found.");
  }

  const serverIdSet = new Set<string>();
  const ids = expired.map((inv) => {
    serverIdSet.add(inv.server.toString());
    return inv._id;
  });

  // Batch delete — much faster than looping
  await InviteModel.deleteMany({ _id: { $in: ids } });

  // Remove from IServer.invites arrays in parallel
  await Promise.all(
    [...serverIdSet].map((sid) =>
      ServerModel.updateOne({ _id: sid }, { $pull: { invites: { $in: ids } } }),
    ),
  );

  await Promise.all([...serverIdSet].map((sid) => invalidateInviteCache(sid)));

  return sendSuccess(res, { deletedCount: expired.length }, "Expired invites cleaned up successfully.");
});

export default {
  createInvite,
  getInvite,
  joinServerWithInvite,
  getServerInvites,
  deleteInvite,
  cleanupExpiredInvites,
};