import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { MessageModel } from "../models/message.model.js";
import { ChannelModel } from "../models/channel.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToChannel, emitToUser } from "../socket/socketHandler.js";
import { validateObjectId } from "../utils/validateObjId.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL = {
  MESSAGES: 300,
  MESSAGE: 600,
  PINNED: 900,
} as const;

const getCacheKey = {
  channelMessages: (channelId: string, page: number, limit: number): string =>
    `channel:${channelId}:messages:${page}:${limit}`,
  message: (messageId: string): string => `message:${messageId}`,
  pinnedMessages: (channelId: string): string => `channel:${channelId}:pinned`,
};

const invalidateMessageCache = async (
  channelId: string,
  messageId: string | null = null,
): Promise<void> => {
  const keys = await pubClient.keys(`channel:${channelId}:messages:*`);
  keys.push(getCacheKey.pinnedMessages(channelId));
  if (messageId) keys.push(getCacheKey.message(messageId));
  if (keys.length > 0) await pubClient.del(...keys);
};

// ─── Channel access helper ────────────────────────────────────────────────────

const checkChannelAccess = async (channelId: string, userId: string) => {
  const channel = await ChannelModel.findById(channelId).lean();
  if (!channel) throw ApiError.notFound("Channel not found.");

  const membership = await ServerMemberModel.findOne({
    server: channel.server,
    user: userId,
  });
  if (!membership) throw ApiError.forbidden(ERROR_MESSAGES.NOT_SERVER_MEMBER);

  if (channel.isPrivate && !["owner", "admin"].includes(membership.role)) {
    if (
      channel.allowedRoles.length > 0 &&
      !channel.allowedRoles.some((roleId) =>
        membership.roles?.some((r) => r.toString() === roleId.toString()),
      )
    ) {
      throw ApiError.forbidden("You don't have access to this private channel.");
    }
  }

  return { channel, membership };
};

// ─── Create message ───────────────────────────────────────────────────────────

export const createMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { channelId } = req.params;
  const { content, attachments, mentions, replyTo } = req.body as {
    content: string;
    attachments?: unknown[];
    mentions?: string[];
    replyTo?: string;
  };
  const userId = validateObjectId(req.user._id);

  const { channel } = await checkChannelAccess(channelId, userId);

  const message = await MessageModel.create({
    content,
    author: userId,
    channel: channelId,
    server: channel.server,
    attachments: attachments ?? [],
    mentions: mentions ?? [],
    replyTo: replyTo ?? null,
  });

  const populated = await MessageModel.findById(message._id)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  await invalidateMessageCache(channelId);

  emitToChannel(channelId, "message:created", {
    message: populated,
    channelId,
    timestamp: new Date(),
  });

  // FIX: original used emitToUser without importing it — added to import above
  if (mentions && mentions.length > 0) {
    mentions.forEach((mentionedUserId) => {
      emitToUser(mentionedUserId, "message:mentioned", {
        message: populated,
        channelId,
        timestamp: new Date(),
      });
    });
  }

  sendCreated(res, populated, "Message sent successfully.");
});

// ─── Get channel messages ─────────────────────────────────────────────────────

export const getChannelMessages = asyncHandler(async (req: AuthReq, res: Response) => {
  const { channelId } = req.params;
  // FIX: query params are strings — parse explicitly
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "50", 10);
  const before = req.query.before as string | undefined;
  const userId = validateObjectId(req.user._id);

  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.channelMessages(channelId, page, limit);

  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));
  }

  const skip = (page - 1) * limit;

  // FIX: typed query object instead of dynamic property assignment
  interface MsgQuery {
    channel: string;
    createdAt?: { $lt: Date };
  }

  const query: MsgQuery = { channel: channelId };

  if (before) {
    const beforeMessage = await MessageModel.findById(before);
    if (beforeMessage) query.createdAt = { $lt: beforeMessage.createdAt as Date };
  }

  const messages = await MessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean();

  const total = await MessageModel.countDocuments({ channel: channelId });

  const result = {
    messages: messages.reverse(),
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

  sendSuccess(res, result);
});

// ─── Get single message ───────────────────────────────────────────────────────

export const getMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.message(messageId);

  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const message = JSON.parse(cached);
    await checkChannelAccess(message.channel.toString(), userId);
    return sendSuccess(res, message);
  }

  const message = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean();

  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);
  await pubClient.setex(cacheKey, CACHE_TTL.MESSAGE, JSON.stringify(message));

  sendSuccess(res, message);
});

// ─── Update message ───────────────────────────────────────────────────────────

export const updateMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const { content } = req.body as { content: string };
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

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

  const updated = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:updated", {
    message: updated,
    timestamp: new Date(),
  });

  sendSuccess(res, updated, "Message updated successfully.");
});

// ─── Delete message ───────────────────────────────────────────────────────────

export const deleteMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);
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

  sendSuccess(res, null, "Message deleted successfully.");
});

// ─── Toggle pin ───────────────────────────────────────────────────────────────

export const togglePinMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  const { membership } = await checkChannelAccess(message.channel.toString(), userId);
  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw ApiError.forbidden("Only admins and moderators can pin messages.");
  }

  message.isPinned = !message.isPinned;
  await message.save();

  const updated = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:pinned", {
    message: updated,
    isPinned: message.isPinned,
    pinnedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(
    res,
    updated,
    `Message ${message.isPinned ? "pinned" : "unpinned"} successfully.`,
  );
});

// ─── Get pinned messages ──────────────────────────────────────────────────────

export const getPinnedMessages = asyncHandler(async (req: AuthReq, res: Response) => {
  const { channelId } = req.params;
  const userId = validateObjectId(req.user._id);

  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.pinnedMessages(channelId);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const pinned = await MessageModel.find({ channel: channelId, isPinned: true })
    .sort({ createdAt: -1 })
    .populate("author", "username avatar status")
    .lean();

  await pubClient.setex(cacheKey, CACHE_TTL.PINNED, JSON.stringify(pinned));

  sendSuccess(res, pinned);
});

// ─── Add reaction ─────────────────────────────────────────────────────────────

export const addReaction = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const { emoji } = req.body as { emoji: string };
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);

  const existing = message.reactions.find((r) => r.emoji === emoji);
  if (existing) {
    // FIX: original used Array.includes on ObjectId array — must compare via .toString()
    if (existing.users.some((id) => id.toString() === userId)) {
      throw ApiError.badRequest("You already reacted with this emoji.");
    }
    existing.users.push(userId as unknown as Types.ObjectId);
  } else {
    message.reactions.push({ emoji, users: [userId as unknown as Types.ObjectId] });
  }

  await message.save();

  const updated = await MessageModel.findById(messageId)
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

  sendSuccess(res, updated, "Reaction added successfully.");
});

// ─── Remove reaction ──────────────────────────────────────────────────────────

export const removeReaction = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId, emoji } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  await checkChannelAccess(message.channel.toString(), userId);

  const reaction = message.reactions.find((r) => r.emoji === emoji);
  if (!reaction) throw ApiError.notFound("Reaction not found.");

  // FIX: same ObjectId string comparison fix as addReaction
  reaction.users = reaction.users.filter((id) => id.toString() !== userId);

  if (reaction.users.length === 0) {
    message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
  }

  await message.save();

  const updated = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .lean();

  await invalidateMessageCache(message.channel.toString(), messageId);

  emitToChannel(message.channel.toString(), "message:reactionRemoved", {
    messageId,
    emoji,
    userId,
    timestamp: new Date(),
  });

  sendSuccess(res, updated, "Reaction removed successfully.");
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