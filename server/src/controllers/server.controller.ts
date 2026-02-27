import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { SUCCESS_MESSAGES } from "../constants/successMessages.js";
import { ServerModel } from "../models/server.model.js";
import { ChannelModel } from "../models/channel.model.js";
import { pubClient } from "../config/redis.config.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { validateObjectId } from "../utils/validateObjId.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Create server ────────────────────────────────────────────────────────────

export const createServer = asyncHandler(async (req: AuthReq, res: Response) => {
  const { name, description, icon, isPublic } = req.body as {
    name: string;
    description?: string;
    icon?: string;
    isPublic?: boolean;
  };
  // FIX: original called validateObjectId(req.user._id) multiple times per handler
  // — call once, reuse the string result throughout
  const userId = validateObjectId(req.user._id);

  const existing = await ServerModel.findOne({ name, owner: userId });
  if (existing) throw ApiError.conflict("A server with this name already exists.");

  const server = await ServerModel.create({
    name,
    description,
    icon,
    isPublic: isPublic ?? false,
    owner: userId,
  });

  const ownerMember = await ServerMemberModel.create({
    user: userId,
    server: server._id,
    role: "owner",
  });

  server.members.push(ownerMember._id);

  const [generalChannel, voiceChannel] = await Promise.all([
    ChannelModel.create({ name: "general", type: "text", server: server._id, position: 0 }),
    ChannelModel.create({ name: "General Voice", type: "voice", server: server._id, position: 1 }),
  ]);

  server.channels.push(generalChannel._id, voiceChannel._id);
  await server.save();

  await pubClient.setex(`server:${server._id}`, 3600, JSON.stringify(server));

  const populated = await ServerModel.findById(server._id)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({ path: "members", populate: { path: "user", select: "username avatar status" } });

  sendCreated(res, populated, SUCCESS_MESSAGES.SERVER_CREATED);
});

// ─── Get user servers ─────────────────────────────────────────────────────────

export const getUserServers = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);

  const memberships = await ServerMemberModel.find({ user: userId }).select("server");
  const serverIds = memberships.map((m) => m.server);

  const servers = await ServerModel.find({ _id: { $in: serverIds } })
    .populate("owner", "username avatar")
    .populate("channels")
    .sort({ createdAt: -1 });

  sendSuccess(res, servers, "Server list fetched successfully.");
});

// ─── Get server by ID ─────────────────────────────────────────────────────────

export const getServer = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  const cached = await pubClient.get(`server:${serverId}`);
  if (cached) {
    const server = JSON.parse(cached);
    const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
    if (!isMember && !server.isPublic) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
    return sendSuccess(res, server);
  }

  const server = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({ path: "members", populate: { path: "user", select: "username avatar status" } });

  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
  if (!isMember && !server.isPublic) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  await pubClient.setex(`server:${serverId}`, 3600, JSON.stringify(server));

  sendSuccess(res, server);
});

// ─── Update server ────────────────────────────────────────────────────────────

export const updateServer = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const { name, description, icon, banner, isPublic } = req.body as {
    name?: string;
    description?: string;
    icon?: string | null;
    banner?: string | null;
    isPublic?: boolean;
  };
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // FIX: original had validateObjectId(validateObjectId(req.user._id)) — double call
  // was comparing a string to string which worked by accident, but was clearly wrong
  if (server.owner.toString() !== userId) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  if (name) server.name = name;
  if (description !== undefined) server.description = description;
  if (icon !== undefined) server.icon = icon ?? "";
  if (banner !== undefined) server.banner = banner ?? "";
  if (isPublic !== undefined) server.isPublic = isPublic;

  await server.save();
  await pubClient.del(`server:${serverId}`);

  const updated = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels");

  sendSuccess(res, updated, SUCCESS_MESSAGES.SERVER_UPDATED);
});

// ─── Delete server ────────────────────────────────────────────────────────────

export const deleteServer = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // FIX: same double validateObjectId removed
  if (server.owner.toString() !== userId) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  await Promise.all([
    ChannelModel.deleteMany({ server: serverId }),
    ServerMemberModel.deleteMany({ server: serverId }),
  ]);

  await server.deleteOne();
  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_DELETED);
});

// ─── Leave server ─────────────────────────────────────────────────────────────

export const leaveServer = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // FIX: same double validateObjectId removed; also original threw using SUCCESS_MESSAGES
  // for an error condition — replaced with a proper error
  if (server.owner.toString() === userId) {
    throw ApiError.badRequest(
      "Server owners cannot leave their own server. Transfer ownership or delete the server first.",
    );
  }

  const membership = await ServerMemberModel.findOneAndDelete({
    server: serverId,
    user: userId,
  });

  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  // FIX: server.members contains ServerMember _ids, not user ids — filter by membership._id
  server.members = server.members.filter(
    (m) => m.toString() !== membership._id.toString(),
  );
  await server.save();

  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_LEFT);
});

// ─── Update member role ───────────────────────────────────────────────────────

export const updateMemberRole = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId, memberId } = req.params;
  const { role } = req.body as { role: "admin" | "moderator" | "member" };
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const requester = await ServerMemberModel.findOne({ server: serverId, user: userId });
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw ApiError.forbidden("Only owners and admins can update member roles.");
  }

  const target = await ServerMemberModel.findOne({ server: serverId, user: memberId });
  if (!target) throw ApiError.notFound("Member not found in this server.");

  if (target.role === "owner") throw ApiError.forbidden("Cannot change the owner's role.");

  target.role = role;
  await target.save();

  await pubClient.del(`server:${serverId}`);

  const updated = await ServerMemberModel.findById(target._id).populate(
    "user",
    "username avatar status",
  );

  sendSuccess(res, updated, "Member role updated successfully.");
});

// ─── Kick member ──────────────────────────────────────────────────────────────

export const kickMember = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId, memberId } = req.params;
  const userId = validateObjectId(req.user._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const requester = await ServerMemberModel.findOne({ server: serverId, user: userId });
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw ApiError.forbidden("Only owners and admins can kick members.");
  }

  const target = await ServerMemberModel.findOne({ server: serverId, user: memberId });
  if (!target) throw ApiError.notFound("Member not found in this server.");

  if (target.role === "owner") throw ApiError.forbidden("Cannot kick the server owner.");

  await ServerMemberModel.findByIdAndDelete(target._id);

  server.members = server.members.filter(
    (m) => m.toString() !== target._id.toString(),
  );
  await server.save();

  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, "Member kicked successfully.");
});

// ─── Get server members ───────────────────────────────────────────────────────

export const getServerMembers = asyncHandler(async (req: AuthReq, res: Response) => {
  const { serverId } = req.params;
  const userId = validateObjectId(req.user._id);

  const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
  if (!isMember) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  const members = await ServerMemberModel.find({ server: serverId })
    .populate("user", "username avatar status lastSeen customStatus")
    .sort({ joinedAt: 1 });

  sendSuccess(res, members);
});