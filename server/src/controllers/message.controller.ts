import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import type { IMessage, IChannel, IServerMember } from "@/types/models";
import { MessageModel } from "@/models/message.model";
import { ChannelModel } from "@/models/channel.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { pubClient } from "@/config/redis.config";
import { emitToChannel, emitToUser } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";

// ─── Cache helpers
const CACHE_TTL = {
  MESSAGES: 300, // 5 minutes
  MESSAGE: 600,  // 10 minutes
  PINNED: 900,   // 15 minutes
} as const;

const getCacheKey = {
  channelMessages: (channelId: string, page: number, limit: number) =>
    `channel:${channelId}:messages:${page}:${limit}`,
  message: (messageId: string) => `message:${messageId}`,
  pinnedMessages: (channelId: string) => `channel:${channelId}:pinned`,
};

const invalidateMessageCache = async (
  channelId: string,
  messageId?: string,
): Promise<void> => {
  const keys = await pubClient.keys(`channel:${channelId}:messages:*`);
  keys.push(getCacheKey.pinnedMessages(channelId));
  if (messageId) keys.push(getCacheKey.message(messageId));
  if (keys.length > 0) await pubClient.del(...keys);
};

// ─── Channel access helper
type ChannelAccessResult = { channel: IChannel; membership: IServerMember };

const checkChannelAccess = async (
  channelId: string,
  userId: string,
): Promise<ChannelAccessResult> => {
  const channel = await ChannelModel.findById(channelId).lean<IChannel>();
  if (!channel) throw ApiError.notFound("Channel not found.");

  const membership = await ServerMemberModel.findOne<IServerMember>({
    server: channel.server,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  // IChannel.isPrivate, IChannel.allowedRoles: Types.ObjectId[]
  if (channel.isPrivate && !["owner", "admin"].includes(membership.role)) {
    const hasRole = channel.allowedRoles.some((roleId) =>
      // IServerMember.roles: Types.ObjectId[] — compare as strings
      membership.roles?.some((r) => r.toString() === roleId.toString()),
    );
    if (!hasRole) {
      throw ApiError.forbidden("You don't have access to this private channel.");
    }
  }

  return { channel, membership };
};

// ─── Create a new message in a channel
export const createMessage = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.params as { channelId: string };
  const { content, attachments, mentions, replyTo } = req.body as {
    content: string;
    attachments?: IMessage["attachments"];
    mentions?: string[];
    replyTo?: string;
  };
  const userId = validateObjectId(req.user!._id);

  // IChannel.server stamped on the message for server-level queries
  const { channel } = await checkChannelAccess(channelId, userId);

  const message = await MessageModel.create({
    content,
    author: userId,
    channel: channelId,
    server: channel.server,
    attachments: attachments ?? [],
    mentions: mentions ?? [],
    replyTo: replyTo ?? undefined,
  });

  const populatedMessage = await MessageModel.findById<IMessage>(message._id)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  await invalidateMessageCache(channelId);

  emitToChannel(channelId, "message:created", {
    message: populatedMessage,
    channelId,
    timestamp: new Date(),
  });

  // IMessage.mentions: Types.ObjectId[] — notify each mentioned user
  if (mentions && mentions.length > 0) {
    mentions.forEach((mentionedUserId) => {
      emitToUser(mentionedUserId, "message:mentioned", {
        message: populatedMessage,
        channelId,
        timestamp: new Date(),
      });
    });
  }

  return sendCreated(res, populatedMessage, "Message sent successfully.");
});

// ─── Get messages from a channel (paginated)
export const getChannelMessages = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.params as { channelId: string };
  // Query params are always strings from Express — parse explicitly
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "50", 10);
  const before = req.query.before as string | undefined;
  const userId = validateObjectId(req.user!._id);

  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.channelMessages(channelId, page, limit);

  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));
  }

  const skip = (page - 1) * limit;

  // Typed filter — avoids dynamic property mutation
  type MsgFilter = { channel: string; createdAt?: { $lt: Date } };
  const filter: MsgFilter = { channel: channelId };

  if (before) {
    const pivot = await MessageModel.findById(before).lean<IMessage>();
    if (pivot) filter.createdAt = { $lt: pivot.createdAt as Date };
  }

  const messages = await MessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean<IMessage[]>();

  const total = await MessageModel.countDocuments({ channel: channelId });

  const result = {
    messages: messages.reverse(), // oldest first
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasMore: skip + messages.length < total,
    },
  };

  if (!before) {
    await pubClient.setex(cacheKey, CACHE_TTL.MESSAGES, JSON.stringify(result));
  }

  return sendSuccess(res, result);
});

// ─── Get a single message by ID
export const getMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params as { messageId: string };
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.message(messageId);

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const message = JSON.parse(cached) as IMessage;
    await checkChannelAccess(message.channel.toString(), userId);
    return sendSuccess(res, message);
  }

  const message = await MessageModel.findById<IMessage>(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean();

  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);
  await pubClient.setex(cacheKey, CACHE_TTL.MESSAGE, JSON.stringify(message));

  return sendSuccess(res, message);
});

// ─── Update / Edit a message
export const updateMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params as { messageId: string };
  const { content } = req.body as { content: string };
  const userId = validateObjectId(req.user!._id);

  const message = await MessageModel.findById<IMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  // IMessage.author: Types.ObjectId
  if (message.author.toString() !== userId) {
    const { membership } = await checkChannelAccess(message.channel.toString(), userId);
    if (!["owner", "admin"].includes(membership.role)) {
      throw ApiError.forbidden("You can only edit your own messages.");
    }
  }

  message.content = content;
  message.isEdited = true;
  message.editedAt = new Date();
  await message.save();

  const updatedMessage = await MessageModel.findById<IMessage>(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:updated", {
    message: updatedMessage,
    timestamp: new Date(),
  });

  return sendSuccess(res, updatedMessage, "Message updated successfully.");
});

// ─── Delete a message
export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params as { messageId: string };
  const userId = validateObjectId(req.user!._id);

  const message = await MessageModel.findById<IMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  if (message.author.toString() !== userId) {
    const { membership } = await checkChannelAccess(message.channel.toString(), userId);
    if (!["owner", "admin", "moderator"].includes(membership.role)) {
      throw ApiError.forbidden("You can only delete your own messages.");
    }
  }

  const channelId = message.channel.toString();
  await message.deleteOne();
  await invalidateMessageCache(channelId, messageId);

  emitToChannel(channelId, "message:deleted", {
    messageId,
    channelId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, null, "Message deleted successfully.");
});

// ─── Pin / Unpin a message
export const togglePinMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params as { messageId: string };
  const userId = validateObjectId(req.user!._id);

  const message = await MessageModel.findById<IMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  const { membership } = await checkChannelAccess(message.channel.toString(), userId);
  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw ApiError.forbidden("Only admins and moderators can pin messages.");
  }

  // IMessage.isPinned: boolean
  message.isPinned = !message.isPinned;
  await message.save();

  const updatedMessage = await MessageModel.findById<IMessage>(messageId)
    .populate("author", "username avatar status")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:pinned", {
    message: updatedMessage,
    isPinned: message.isPinned,
    pinnedBy: userId,
    timestamp: new Date(),
  });

  return sendSuccess(
    res,
    updatedMessage,
    `Message ${message.isPinned ? "pinned" : "unpinned"} successfully.`,
  );
});

// ─── Get pinned messages in a channel
export const getPinnedMessages = asyncHandler(async (req: Request, res: Response) => {
  const { channelId } = req.params as { channelId: string };
  const userId = validateObjectId(req.user!._id);

  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.pinnedMessages(channelId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const pinnedMessages = await MessageModel.find({ channel: channelId, isPinned: true })
    .sort({ createdAt: -1 })
    .populate("author", "username avatar status")
    .lean<IMessage[]>();

  await pubClient.setex(cacheKey, CACHE_TTL.PINNED, JSON.stringify(pinnedMessages));

  return sendSuccess(res, pinnedMessages);
});

// ─── Add reaction to a message
export const addReaction = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params as { messageId: string };
  const { emoji } = req.body as { emoji: string };
  const userId = validateObjectId(req.user!._id);

  const message = await MessageModel.findById<IMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);

  // IMessage.reactions: Array<{ emoji: string; users: Types.ObjectId[] }>
  const existingReaction = message.reactions.find((r) => r.emoji === emoji);

  if (existingReaction) {
    // ObjectId[] — must compare via .toString(), not .includes()
    if (existingReaction.users.some((id) => id.toString() === userId)) {
      throw ApiError.badRequest("You already reacted with this emoji.");
    }
    existingReaction.users.push(userId as unknown as Types.ObjectId);
  } else {
    message.reactions.push({ emoji, users: [userId as unknown as Types.ObjectId] });
  }

  await message.save();

  const updatedMessage = await MessageModel.findById<IMessage>(messageId)
    .populate("author", "username avatar status")
    .populate("reactions.users", "username avatar")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:reactionAdded", {
    messageId,
    emoji,
    userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, updatedMessage, "Reaction added successfully.");
});

// ─── Remove reaction from a message
export const removeReaction = asyncHandler(async (req: Request, res: Response) => {
  const { messageId, emoji } = req.params as { messageId: string; emoji: string };
  const userId = validateObjectId(req.user!._id);

  const message = await MessageModel.findById<IMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);

  const reaction = message.reactions.find((r) => r.emoji === emoji);
  if (!reaction) throw ApiError.notFound("Reaction not found.");

  // ObjectId[] string comparison
  reaction.users = reaction.users.filter((id) => id.toString() !== userId);

  if (reaction.users.length === 0) {
    message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
  }

  await message.save();

  const updatedMessage = await MessageModel.findById<IMessage>(messageId)
    .populate("author", "username avatar status")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:reactionRemoved", {
    messageId,
    emoji,
    userId,
    timestamp: new Date(),
  });

  return sendSuccess(res, updatedMessage, "Reaction removed successfully.");
});

export default {
  createMessage,
  getChannelMessages,
  getMessage,
  updateMessage,
  deleteMessage,
  togglePinMessage,
  getPinnedMessages,
  addReaction,
  removeReaction,
};