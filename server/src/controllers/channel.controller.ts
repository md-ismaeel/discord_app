import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";
import type { IChannel } from "@/types/models";
import type { IServerMember } from "@/types/models";
import { ChannelModel } from "@/models/channel.model";
import { ServerModel } from "@/models/server.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { pubClient } from "@/config/redis.config";
import { getIO } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";

//  Constants 
const CACHE_TTL = { CHANNEL: 1800, CHANNELS: 1800 } as const;

const getCacheKey = {
  channel: (id: string) => `channel:${id}`,
  serverChannels: (id: string) => `server:${id}:channels`,
};

//  Cache invalidation 
const invalidateChannelCache = async (
  serverId: Types.ObjectId | string,
  channelId?: string,
): Promise<void> => {
  const keys = [
    getCacheKey.serverChannels(serverId.toString()),
    `server:${serverId}`,
  ];
  if (channelId) keys.push(getCacheKey.channel(channelId));
  await pubClient.del(...keys);
};

//  Permission helper 
// IServerMember.role: "owner" | "admin" | "moderator" | "member"
const checkMemberPermission = async (
  serverId: Types.ObjectId | string,
  userId: string,
  requiredRoles: IServerMember["role"][] = ["owner", "admin"],
): Promise<IServerMember> => {
  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: userId,
  });

  if (!membership) {
    throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  if (!requiredRoles.includes(membership.role)) {
    throw ApiError.forbidden(
      `Only ${requiredRoles.join(", ")} can perform this action.`,
    );
  }

  return membership;
};

//  Create channel
export const createChannel = asyncHandler(async (req: Request, res: Response) => {
  const serverId = req.params.serverId as string;
  const { name, type, topic, category, position, isPrivate, allowedRoles } = req.body as {
    name: string;
    type: IChannel["type"];
    topic?: string;
    category?: string;
    position?: number;
    isPrivate?: boolean;
    allowedRoles?: string[];
  };

  const userId = validateObjectId(req.user!._id);
  const io = getIO();

  await checkMemberPermission(serverId, userId, ["owner", "admin", "moderator"]);

  const server = await ServerModel.findById(serverId);
  if (!server) throw ApiError.notFound(ERROR_MESSAGES.SERVER_NOT_FOUND);

  const duplicate = await ChannelModel.findOne({
    server: serverId,
    name: name.toLowerCase(),
  });
  if (duplicate) {
    throw ApiError.conflict(
      "A channel with this name already exists in this server.",
    );
  }

  const channel = await ChannelModel.create({
    name: name.toLowerCase(),
    type,
    server: serverId,
    topic,
    category,
    position: position ?? server.channels.length,
    isPrivate: isPrivate ?? false,
    allowedRoles: allowedRoles ?? [],
  });

  await ServerModel.findByIdAndUpdate(serverId, {
    $push: { channels: channel._id },
  });

  await invalidateChannelCache(serverId);

  io.to(`server:${serverId}`).emit("channel:created", {
    channel,
    createdBy: userId,
    timestamp: new Date(),
  });

  sendCreated(res, channel, "Channel created successfully.");
});

//  Get server channels
export const getServerChannels = asyncHandler(async (req: Request, res: Response) => {
  const serverId = validateObjectId(req.params.serverId as string);
  const userId = validateObjectId(req.user!._id);

  //  Cache
  const cacheKey = getCacheKey.serverChannels(serverId);

  // IServerMember — verify membership first
  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: serverId,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  // IChannel[] — lean returns plain objects matching the interface shape
  const channels = await ChannelModel.find({ server: serverId })
    .sort({ position: 1 })
    .lean<IChannel[]>();

  const visible = channels.filter((channel) => {
    if (!channel.isPrivate) return true;
    if (["owner", "admin"].includes(membership.role)) return true;
    // IChannel.allowedRoles: Types.ObjectId[]
    return (
      channel.allowedRoles.length === 0 ||
      channel.allowedRoles.some((roleId) =>
        // IServerMember.roles: Types.ObjectId[]
        membership.roles?.some((r) => r.toString() === roleId.toString()),
      )
    );
  });

  await pubClient.setex(cacheKey, CACHE_TTL.CHANNELS, JSON.stringify(visible));

  return sendSuccess(res, visible, SUCCESS_MESSAGES.CHANNELS_FETCHED);
});

//  Get single channel
export const getChannel = asyncHandler(async (req: Request, res: Response) => {
  const channelId = req.params.channelId as string;
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.channel(channelId);

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const channel = JSON.parse(cached) as IChannel;
    const membership = await ServerMemberModel.findOne<IServerMember>({
      server: channel.server,
      user: userId,
    });
    if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);
    sendSuccess(res, channel);
    return;
  }

  const channel = await ChannelModel.findById(channelId).lean<IChannel>();
  if (!channel) throw ApiError.notFound("Channel not found.");

  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: channel.server,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  if (channel.isPrivate && !["owner", "admin"].includes(membership.role)) {
    const hasRole = channel.allowedRoles.some((roleId) =>
      membership.roles?.some((r) => r.toString() === roleId.toString()),
    );
    if (!hasRole) {
      throw ApiError.forbidden("You don't have access to this private channel.");
    }
  }

  await pubClient.setex(cacheKey, CACHE_TTL.CHANNEL, JSON.stringify(channel));

  sendSuccess(res, channel);
});

//  Update channel
export const updateChannel = asyncHandler(async (req: Request, res: Response) => {
  const channelId = req.params.channelId as string;
  const { name, topic, category, position, isPrivate, allowedRoles } =
    req.body as Partial<
      Pick<IChannel, "name" | "topic" | "category" | "position" | "isPrivate"> & {
        allowedRoles: string[];
      }
    >;

  const userId = validateObjectId(req.user!._id);
  const io = getIO();

  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw ApiError.notFound("Channel not found.");

  await checkMemberPermission(channel.server, userId, ["owner", "admin", "moderator"]);

  if (name && name !== channel.name) {
    const duplicate = await ChannelModel.findOne({
      server: channel.server,
      name: name.toLowerCase(),
      _id: { $ne: channelId },
    });
    if (duplicate) {
      throw ApiError.conflict(
        "A channel with this name already exists in this server.",
      );
    }
    channel.name = name.toLowerCase();
  }

  if (topic !== undefined) channel.topic = topic;
  if (category !== undefined) channel.category = category;
  if (position !== undefined) channel.position = position;
  if (isPrivate !== undefined) channel.isPrivate = isPrivate;
  if (allowedRoles !== undefined) {
    channel.allowedRoles = allowedRoles as unknown as Types.ObjectId[];
  }

  await channel.save();
  await invalidateChannelCache(channel.server, channelId);

  io.to(`server:${channel.server}`).emit("channel:updated", {
    channel,
    updatedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, channel, "Channel updated successfully.");
});

//  Delete channel
export const deleteChannel = asyncHandler(async (req: Request, res: Response) => {
  const channelId = req.params.channelId as string;
  const userId = validateObjectId(req.user!._id);
  const io = getIO();

  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw ApiError.notFound("Channel not found.");

  await checkMemberPermission(channel.server, userId, ["owner", "admin"]);

  const serverId = channel.server;

  await ServerModel.findByIdAndUpdate(serverId, {
    $pull: { channels: channelId },
  });

  await channel.deleteOne();
  await invalidateChannelCache(serverId, channelId);

  io.to(`server:${serverId}`).emit("channel:deleted", {
    channelId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Channel deleted successfully.");
});

//  Reorder channels
export const reorderChannels = asyncHandler(async (req: Request, res: Response) => {
  const serverId = req.params.serverId as string;
  const { channelOrder } = req.body as {
    channelOrder: Array<{ channelId: string; position: number }>;
  };
  const userId = validateObjectId(req.user!._id);
  const io = getIO();

  if (!Array.isArray(channelOrder) || channelOrder.length === 0) {
    throw ApiError.badRequest("channelOrder must be a non-empty array.");
  }

  await checkMemberPermission(serverId, userId, ["owner", "admin", "moderator"]);

  await ChannelModel.bulkWrite(
    channelOrder.map(({ channelId, position }) => ({
      updateOne: {
        filter: { _id: channelId, server: serverId },
        update: { $set: { position } },
      },
    })),
  );

  const channels = await ChannelModel.find({ server: serverId })
    .sort({ position: 1 })
    .lean<IChannel[]>();

  await invalidateChannelCache(serverId);

  io.to(`server:${serverId}`).emit("channels:reordered", {
    channels,
    reorderedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, channels, "Channels reordered successfully.");
});

export default {
  createChannel,
  getServerChannels,
  getChannel,
  updateChannel,
  deleteChannel,
  reorderChannels,
};