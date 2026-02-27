import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { SUCCESS_MESSAGES } from "../constants/successMessages.js";
import { ChannelModel } from "../models/channel.model.js";
import { ServerModel } from "../models/server.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { pubClient } from "../config/redis.config.js";
import { getIO } from "../socket/socketHandler.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

const CACHE_TTL = {
  CHANNEL: 1800, // 30 minutes
  CHANNELS: 1800, // 30 minutes
};

const getCacheKey = {
  channel: (channelId) => `channel:${channelId}`,
  serverChannels: (serverId) => `server:${serverId}:channels`,
};

const invalidateChannelCache = async (serverId, channelId = null) => {
  const keys = [getCacheKey.serverChannels(serverId), `server:${serverId}`];

  if (channelId) {
    keys.push(getCacheKey.channel(channelId));
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
      403,
      `Only ${requiredRole.join(", ")} can perform this action`,
    );
  }

  return membership;
};

//    Create a new channel in a server
export const createChannel = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { name, type, topic, category, position, isPrivate, allowedRoles } =
    req.body;
  const io = getIO();

  // Check permissions
  await checkMemberPermission(serverId, req.user._id, [
    "owner",
    "admin",
    "moderator",
  ]);

  // Verify server exists
  const server = await ServerModel.findById(serverId);
  if (!server) {
    throw createApiError(404, ERROR_MESSAGES.SERVER_NOT_FOUND);
  }

  // Check for duplicate channel name in the same server
  const existingChannel = await ChannelModel.findOne({
    server: serverId,
    name: name.toLowerCase(),
  });

  if (existingChannel) {
    throw createApiError(
      400,
      "A channel with this name already exists in this server",
    );
  }

  // Create channel
  const channel = await ChannelModel.create({
    name: name.toLowerCase(),
    type,
    server: serverId,
    topic,
    category,
    position: position ?? server.channels.length,
    isPrivate,
    allowedRoles: allowedRoles || [],
  });

  // Add channel to server
  await ServerModel.findByIdAndUpdate(serverId, {
    $push: { channels: channel._id },
  });

  // Invalidate caches
  await invalidateChannelCache(serverId);

  // Emit socket event
  io.to(`server:${serverId}`).emit("channel:created", {
    channel,
    createdBy: req.user._id,
    timestamp: new Date(),
  });

  sendCreated(res, channel, "Channel created successfully");
});

//    Get all channels in a server
export const getServerChannels = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const cacheKey = getCacheKey.serverChannels(serverId);

  // Check if user is a member
  const membership = await ServerMemberModel.findOne({
    server: serverId,
    user: req.user._id,
  });

  if (!membership) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  // Fetch channels
  const channels = await ChannelModel.find({ server: serverId })
    .sort({ position: 1 })
    .lean();

  // Filter private channels based on user's roles
  const visibleChannels = channels.filter((channel) => {
    if (!channel.isPrivate) return true;

    // Owner and admin can see all channels
    if (["owner", "admin"].includes(membership.role)) return true;

    // Check if user has required role for private channel
    return (
      channel.allowedRoles.length === 0 ||
      channel.allowedRoles.some((roleId) => membership.roles?.includes(roleId))
    );
  });

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.CHANNELS,
    JSON.stringify(visibleChannels),
  );

  sendSuccess(res, visibleChannels, SUCCESS_MESSAGES.CHANNELS_FETCHED);
});

//    Get a single channel by ID
export const getChannel = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const cacheKey = getCacheKey.channel(channelId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const channel = JSON.parse(cached);

    // Verify user has access
    const membership = await ServerMemberModel.findOne({
      server: channel.server,
      user: req.user._id,
    });

    if (!membership) {
      throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
    }

    return sendSuccess(res, channel);
  }

  // Fetch from database
  const channel = await ChannelModel.findById(channelId).lean();

  if (!channel) {
    throw createApiError(404, "Channel not found");
  }

  // Check if user is a server member
  const membership = await ServerMemberModel.findOne({
    server: channel.server,
    user: req.user._id,
  });

  if (!membership) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  // Check if user has access to private channel
  if (channel.isPrivate && !["owner", "admin"].includes(membership.role)) {
    if (
      channel.allowedRoles.length > 0 &&
      !channel.allowedRoles.some((roleId) => membership.roles?.includes(roleId))
    ) {
      throw createApiError(
        403,
        "You don't have access to this private channel",
      );
    }
  }

  // Cache the channel
  await pubClient.setex(cacheKey, CACHE_TTL.CHANNEL, JSON.stringify(channel));

  sendSuccess(res, channel);
});

//    Update a channel
export const updateChannel = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const { name, topic, category, position, isPrivate, allowedRoles } = req.body;
  const io = getIO();

  const channel = await ChannelModel.findById(channelId);

  if (!channel) {
    throw createApiError(404, "Channel not found");
  }

  // Check permissions
  await checkMemberPermission(channel.server, req.user._id, [
    "owner",
    "admin",
    "moderator",
  ]);

  // Check for duplicate name if name is being changed
  if (name && name !== channel.name) {
    const existingChannel = await ChannelModel.findOne({
      server: channel.server,
      name: name.toLowerCase(),
      _id: { $ne: channelId },
    });

    if (existingChannel) {
      throw createApiError(
        400,
        "A channel with this name already exists in this server",
      );
    }
    channel.name = name.toLowerCase();
  }

  // Update fields
  if (topic !== undefined) channel.topic = topic;
  if (category !== undefined) channel.category = category;
  if (position !== undefined) channel.position = position;
  if (isPrivate !== undefined) channel.isPrivate = isPrivate;
  if (allowedRoles !== undefined) channel.allowedRoles = allowedRoles;

  await channel.save();

  // Invalidate caches
  await invalidateChannelCache(channel.server, channelId);

  // Emit socket event
  io.to(`server:${channel.server}`).emit("channel:updated", {
    channel,
    updatedBy: req.user._id,
    timestamp: new Date(),
  });

  sendSuccess(res, channel, "Channel updated successfully");
});

//    Delete a channel
export const deleteChannel = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const io = getIO();

  const channel = await ChannelModel.findById(channelId);

  if (!channel) {
    throw createApiError(404, "Channel not found");
  }

  // Check permissions (only owner and admin can delete)
  await checkMemberPermission(channel.server, req.user._id, ["owner", "admin"]);

  const serverId = channel.server;

  // Remove channel from server
  await ServerModel.findByIdAndUpdate(serverId, {
    $pull: { channels: channelId },
  });

  // Delete the channel
  await channel.deleteOne();

  // Invalidate caches
  await invalidateChannelCache(serverId, channelId);

  // Emit socket event
  io.to(`server:${serverId}`).emit("channel:deleted", {
    channelId,
    deletedBy: req.user._id,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Channel deleted successfully");
});

//    Reorder channels
export const reorderChannels = asyncHandler(async (req, res) => {
  const { serverId } = req.params;
  const { channelOrder } = req.body; // Array of { channelId, position }
  const io = getIO();

  // Validate request body
  if (!Array.isArray(channelOrder) || channelOrder.length === 0) {
    throw createApiError(400, "channelOrder must be a non-empty array");
  }

  // Check permissions
  await checkMemberPermission(serverId, req.user._id, [
    "owner",
    "admin",
    "moderator",
  ]);

  // Update positions in bulk
  const bulkOps = channelOrder.map(({ channelId, position }) => ({
    updateOne: {
      filter: { _id: channelId, server: serverId },
      update: { $set: { position } },
    },
  }));

  await ChannelModel.bulkWrite(bulkOps);

  // Get updated channels
  const channels = await ChannelModel.find({ server: serverId })
    .sort({ position: 1 })
    .lean();

  // Invalidate caches
  await invalidateChannelCache(serverId);

  // Emit socket event
  io.to(`server:${serverId}`).emit("channels:reordered", {
    channels,
    reorderedBy: req.user._id,
    timestamp: new Date(),
  });

  sendSuccess(res, channels, "Channels reordered successfully");
});

export default {
  createChannel,
  getServerChannels,
  getChannel,
  updateChannel,
  deleteChannel,
  reorderChannels,
};
