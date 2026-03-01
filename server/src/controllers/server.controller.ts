import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";
import type { IServer, IServerMember } from "@/types/models";
import { ServerModel } from "@/models/server.model";
import { ChannelModel } from "@/models/channel.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { pubClient } from "@/config/redis.config";
import { validateObjectId } from "@/utils/validateObjId";

// ─── Create a new server
export const createServer = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, icon, isPublic } = req.body as {
    name: string;
    description?: string;
    icon?: string;
    isPublic?: boolean;
  };
  const userId = validateObjectId(req.user!._id);

  const existingServer = await ServerModel.findOne({ name, owner: userId });
  if (existingServer) {
    throw ApiError.conflict("A server with this name already exists.");
  }

  const server = await ServerModel.create({
    name,
    description,
    icon,
    isPublic: isPublic ?? false,
    owner: userId,
  });

  // Create the owner's ServerMember entry
  const ownerMember = await ServerMemberModel.create({
    user: userId,
    server: server._id,
    role: "owner",
  });

  // IServer.members: Types.ObjectId[]
  server.members.push(ownerMember._id);

  // Create default channels in parallel
  const [generalChannel, voiceChannel] = await Promise.all([
    ChannelModel.create({ name: "general", type: "text", server: server._id, position: 0 }),
    ChannelModel.create({ name: "General Voice", type: "voice", server: server._id, position: 1 }),
  ]);

  // IServer.channels: Types.ObjectId[]
  server.channels.push(generalChannel._id, voiceChannel._id);
  await server.save();

  await pubClient.setex(`server:${server._id}`, 3600, JSON.stringify(server));

  const populatedServer = await ServerModel.findById(server._id)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({ path: "members", populate: { path: "user", select: "username avatar status" } });

  return sendCreated(res, populatedServer, SUCCESS_MESSAGES.SERVER_CREATED);
});

// ─── Get all servers for the current user
export const getUserServers = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);

  const memberships = await ServerMemberModel.find({ user: userId }).select("server");
  const serverIds = memberships.map((m) => m.server);

  const servers = await ServerModel.find({ _id: { $in: serverIds } })
    .populate("owner", "username avatar")
    .populate("channels")
    .sort({ createdAt: -1 });

  return sendSuccess(res, servers, "Server list fetched successfully.");
});

// ─── Get server by ID
export const getServer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  const cached = await pubClient.get(`server:${serverId}`);
  if (cached) {
    const server = JSON.parse(cached) as IServer;
    const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
    if (!isMember && !server.isPublic) {
      throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
    }
    return sendSuccess(res, server);
  }

  const server = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({ path: "members", populate: { path: "user", select: "username avatar status" } });

  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
  if (!isMember && !server.isPublic) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  await pubClient.setex(`server:${serverId}`, 3600, JSON.stringify(server));

  return sendSuccess(res, server);
});

// ─── Update server
export const updateServer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const { name, description, icon, banner, isPublic } = req.body as {
    name?: string;
    description?: string;
    icon?: string | null;
    banner?: string | null;
    isPublic?: boolean;
  };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById<IServer>(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // IServer.owner: Types.ObjectId
  if (server.owner.toString() !== userId) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  if (name) server.name = name;
  if (description !== undefined) server.description = description;
  if (icon !== undefined) server.icon = icon ?? undefined;
  if (banner !== undefined) server.banner = banner ?? undefined;
  if (isPublic !== undefined) server.isPublic = isPublic;

  await server.save();
  await pubClient.del(`server:${serverId}`);

  const updatedServer = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels");

  return sendSuccess(res, updatedServer, SUCCESS_MESSAGES.SERVER_UPDATED);
});

// ─── Delete server
export const deleteServer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById<IServer>(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // IServer.owner: Types.ObjectId
  if (server.owner.toString() !== userId) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  // Delete channels and members in parallel
  await Promise.all([
    ChannelModel.deleteMany({ server: serverId }),
    ServerMemberModel.deleteMany({ server: serverId }),
  ]);

  await server.deleteOne();
  await pubClient.del(`server:${serverId}`);

  return sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_DELETED);
});

// ─── Leave server
export const leaveServer = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById<IServer>(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  // IServer.owner: Types.ObjectId — owner cannot leave
  if (server.owner.toString() === userId) {
    throw ApiError.badRequest(
      "Server owners cannot leave. Transfer ownership or delete the server first.",
    );
  }

  const membership = await ServerMemberModel.findOneAndDelete<IServerMember>({
    server: serverId,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  // IServer.members holds ServerMember _ids — filter by membership._id
  server.members = server.members.filter(
    (m) => m.toString() !== membership._id.toString(),
  );
  await server.save();
  await pubClient.del(`server:${serverId}`);

  return sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_LEFT);
});

// ─── Update member role
export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, memberId } = req.params as { serverId: string; memberId: string };
  // IServerMember.role: "owner" | "admin" | "moderator" | "member"
  const { role } = req.body as { role: Exclude<IServerMember["role"], "owner"> };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const requester = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: userId,
  });
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw ApiError.forbidden("Only owners and admins can update member roles.");
  }

  const target = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: memberId,
  });
  if (!target) throw ApiError.notFound("Member not found in this server.");

  if (target.role === "owner") throw ApiError.forbidden("Cannot change the owner's role.");

  target.role = role;
  await target.save();

  await pubClient.del(`server:${serverId}`);

  const updatedMember = await ServerMemberModel.findById(target._id).populate(
    "user",
    "username avatar status",
  );

  return sendSuccess(res, updatedMember, "Member role updated successfully.");
});

// ─── Kick member from server
export const kickMember = asyncHandler(async (req: Request, res: Response) => {
  const { serverId, memberId } = req.params as { serverId: string; memberId: string };
  const userId = validateObjectId(req.user!._id);

  const server = await ServerModel.findById<IServer>(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const requester = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: userId,
  });
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw ApiError.forbidden("Only owners and admins can kick members.");
  }

  const target = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: memberId,
  });
  if (!target) throw ApiError.notFound("Member not found in this server.");

  if (target.role === "owner") throw ApiError.forbidden("Cannot kick the server owner.");

  await ServerMemberModel.findByIdAndDelete(target._id);

  // IServer.members: Types.ObjectId[] — remove by target._id
  server.members = server.members.filter(
    (m) => m.toString() !== target._id.toString(),
  );
  await server.save();
  await pubClient.del(`server:${serverId}`);

  return sendSuccess(res, null, "Member kicked successfully.");
});

// ─── Get server members
export const getServerMembers = asyncHandler(async (req: Request, res: Response) => {
  const { serverId } = req.params as { serverId: string };
  const userId = validateObjectId(req.user!._id);

  const isMember = await ServerMemberModel.exists({ server: serverId, user: userId });
  if (!isMember) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  const members = await ServerMemberModel.find({ server: serverId })
    .populate("user", "username avatar status lastSeen customStatus")
    .sort({ joinedAt: 1 });

  return sendSuccess(res, members);
});

export default {
  createServer,
  getUserServers,
  getServer,
  updateServer,
  deleteServer,
  leaveServer,
  updateMemberRole,
  kickMember,
  getServerMembers,
};