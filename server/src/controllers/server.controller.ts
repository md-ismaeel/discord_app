import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { SUCCESS_MESSAGES } from "../constants/successMessages.js";
import { ServerModel } from "../models/server.model.js";
import { ChannelModel } from "../models/channel.model.js";
import { pubClient } from "../config/redis.config.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { validateObjectId } from "../utils/validateObjId.js";

// @desc    Create a new server
export const createServer = asyncHandler(async (req, res) => {
  const { name, description, icon, isPublic } = req.body;

  const existingServer = await ServerModel.findOne({
    name,
    owner: validateObjectId(req.user._id),
  });
  if (existingServer) {
    throw createApiError(
      HTTP_STATUS.CONFLICT,
      "A server with this name already exists",
    );
  }

  // Create server
  const server = await ServerModel.create({
    name,
    description,
    icon,
    isPublic,
    owner: validateObjectId(req.user._id),
  });

  // Create server member entry for owner
  const ownerMember = await ServerMemberModel.create({
    user: validateObjectId(req.user._id),
    server: server._id,
    role: "owner",
  });

  server.members.push(ownerMember._id);

  // Create default channels
  const generalChannel = await ChannelModel.create({
    name: "general",
    type: "text",
    server: server._id,
    position: 0,
  });

  const voiceChannel = await ChannelModel.create({
    name: "General Voice",
    type: "voice",
    server: server._id,
    position: 1,
  });

  server.channels.push(generalChannel._id, voiceChannel._id);
  await server.save();

  // Cache server data in Redis
  await pubClient.setex(
    `server:${server._id}`,
    3600, // 1 hour
    JSON.stringify(server),
  );

  const populatedServer = await ServerModel.findById(server._id)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({
      path: "members",
      populate: { path: "user", select: "username avatar status" },
    });

  sendCreated(res, populatedServer, SUCCESS_MESSAGES.SERVER_CREATED);
});

// @desc    Get all servers for current user
export const getUserServers = asyncHandler(async (req, res) => {
  // Find all server memberships for the user
  const memberships = await ServerMemberModel.find({
    user: validateObjectId(req.user._id),
  }).select("server");

  const serverIds = memberships.map((m) => m.server);

  const servers = await ServerModel.find({ _id: { $in: serverIds } })
    .populate("owner", "username avatar")
    .populate("channels")
    .sort({ createdAt: -1 });

  sendSuccess(res, servers, "Server list fetched successfully!");
});

// @desc    Get server by ID
export const getServer = asyncHandler(async (req, res) => {
  const { serverId } = req.params;

  // Try to get from cache first
  const cached = await pubClient.get(`server:${serverId}`);
  if (cached) {
    const server = JSON.parse(cached);

    // Check if user is a member
    const isMember = await ServerMemberModel.exists({
      server: serverId,
      user: validateObjectId(req.user._id),
    });

    if (!isMember && !server.isPublic) {
      throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
    }

    return sendSuccess(res, server);
  }

  const server = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels")
    .populate({
      path: "members",
      populate: { path: "user", select: "username avatar status" },
    });

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check if user is a member
  const isMember = await ServerMemberModel.exists({
    server: serverId,
    user: validateObjectId(req.user._id),
  });

  if (!isMember && !server.isPublic) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  // Cache the server
  await pubClient.setex(`server:${serverId}`, 3600, JSON.stringify(server));

  sendSuccess(res, server);
});

// @desc    Update server
export const updateServer = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { name, description, icon, banner, isPublic } = req.body;

  const server = await ServerModel.findById(serverId);

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check if user is the owner
  if (
    server.owner.toString() !== validateObjectId(validateObjectId(req.user._id))
  ) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  if (name) server.name = name;
  if (description !== undefined) server.description = description;
  if (icon !== undefined) server.icon = icon;
  if (banner !== undefined) server.banner = banner;
  if (isPublic !== undefined) server.isPublic = isPublic;

  await server.save();

  // Invalidate cache
  await pubClient.del(`server:${serverId}`);

  const updatedServer = await ServerModel.findById(serverId)
    .populate("owner", "username avatar")
    .populate("channels");

  sendSuccess(res, updatedServer, SUCCESS_MESSAGES.SERVER_UPDATED);
});

// @desc    Delete server
export const deleteServer = asyncHandler(async (req, res) => {
  const { serverId } = req.params;

  const server = await ServerModel.findById(serverId);

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check if user is the owner
  if (
    server.owner.toString() !== validateObjectId(validateObjectId(req.user._id))
  ) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_OWNER);
  }

  // Delete all channels
  await ChannelModel.deleteMany({ server: serverId });

  // Delete all server members
  await ServerMemberModel.deleteMany({ server: serverId });

  // Delete server
  await server.deleteOne();

  // Invalidate cache
  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_DELETED);
});

// @desc    Leave server
export const leaveServer = asyncHandler(async (req, res) => {
  const { serverId } = req.params;

  const server = await ServerModel.findById(serverId);

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Owner cannot leave their own server
  if (
    server.owner.toString() === validateObjectId(validateObjectId(req.user._id))
  ) {
    throw createApiError(400, SUCCESS_MESSAGES.SERVER_OWNER_NOT_LEAVE);
  }

  // Find and remove server member
  const membership = await ServerMemberModel.findOneAndDelete({
    server: serverId,
    user: validateObjectId(req.user._id),
  });

  if (!membership) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  // Remove from server's members array
  server.members = server.members.filter(
    (m) => m.toString() !== membership._id.toString(),
  );
  await server.save();

  // Invalidate cache
  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, SUCCESS_MESSAGES.SERVER_LEFT);
});

// @desc    Update member role
export const updateMemberRole = asyncHandler(async (req, res) => {
  const { serverId, memberId } = req.params;
  const { role } = req.body;

  const server = await ServerModel.findById(serverId);

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check if requester is owner or admin
  const requester = await ServerMemberModel.findOne({
    server: serverId,
    user: validateObjectId(req.user._id),
  });

  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw createApiError(403, "Only owners and admins can update member roles");
  }

  // Find the member to update
  const memberToUpdate = await ServerMemberModel.findOne({
    server: serverId,
    user: memberId,
  });

  if (!memberToUpdate) {
    throw createApiError(404, "Member not found in this server");
  }

  // Cannot change owner role
  if (memberToUpdate.role === "owner") {
    throw createApiError(403, "Cannot change owner role");
  }

  memberToUpdate.role = role;
  await memberToUpdate.save();

  // Invalidate cache
  await pubClient.del(`server:${serverId}`);

  const updatedMember = await ServerMemberModel.findById(
    memberToUpdate._id,
  ).populate("user", "username avatar status");

  sendSuccess(res, updatedMember, "Member role updated successfully");
});

// @desc    Kick member from server
export const kickMember = asyncHandler(async (req, res) => {
  const { serverId, memberId } = req.params;

  const server = await ServerModel.findById(serverId);

  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check if requester is owner or admin
  const requester = await ServerMemberModel.findOne({
    server: serverId,
    user: validateObjectId(req.user._id),
  });

  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw createApiError(403, "Only owners and admins can kick members");
  }

  // Find member to kick
  const memberToKick = await ServerMemberModel.findOne({
    server: serverId,
    user: memberId,
  });

  if (!memberToKick) {
    throw createApiError(404, "Member not found in this server");
  }

  // Cannot kick owner
  if (memberToKick.role === "owner") {
    throw createApiError(403, "Cannot kick the server owner");
  }

  // Remove member
  await ServerMemberModel.findByIdAndDelete(memberToKick._id);

  // Remove from server's members array
  server.members = server.members.filter(
    (m) => m.toString() !== memberToKick._id.toString(),
  );
  await server.save();

  // Invalidate cache
  await pubClient.del(`server:${serverId}`);

  sendSuccess(res, null, "Member kicked successfully");
});

// @desc    Get server members
export const getServerMembers = asyncHandler(async (req, res) => {
  const { serverId } = req.params;

  // Check if user is a member
  const isMember = await ServerMemberModel.exists({
    server: serverId,
    user: validateObjectId(req.user._id),
  });

  if (!isMember) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  const members = await ServerMemberModel.find({ server: serverId })
    .populate("user", "username avatar status lastSeen customStatus")
    .sort({ joinedAt: 1 });

  sendSuccess(res, members);
});
