import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { MessageModel } from "../models/message.model.js";
import { ChannelModel } from "../models/channel.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToChannel } from "../socket/socketHandler.js";

const CACHE_TTL = {
  MESSAGES: 300, // 5 minutes
  MESSAGE: 600, // 10 minutes
  PINNED: 900, // 15 minutes
};

const getCacheKey = {
  channelMessages: (channelId, page, limit) =>
    `channel:${channelId}:messages:${page}:${limit}`,
  message: (messageId) => `message:${messageId}`,
  pinnedMessages: (channelId) => `channel:${channelId}:pinned`,
};

const invalidateMessageCache = async (channelId, messageId = null) => {
  // Delete all paginated message caches for this channel
  const messageKeys = await pubClient.keys(`channel:${channelId}:messages:*`);
  const keysToDelete = [...messageKeys, getCacheKey.pinnedMessages(channelId)];

  if (messageId) {
    keysToDelete.push(getCacheKey.message(messageId));
  }

  if (keysToDelete.length > 0) {
    await pubClient.del(...keysToDelete);
  }
};

// Helper to check member access
const checkChannelAccess = async (channelId, userId) => {
  const channel = await ChannelModel.findById(channelId).lean();

  if (!channel) {
    throw createApiError(404, "Channel not found");
  }

  const membership = await ServerMemberModel.findOne({
    server: channel.server,
    user: userId,
  });

  if (!membership) {
    throw createApiError(403, ERROR_MESSAGES.NOT_SERVER_MEMBER);
  }

  // Check private channel access
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

  return { channel, membership };
};

//    Create a new message in a channel
export const createMessage = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const { content, attachments, mentions, replyTo } = req.body;
  const userId = validateObjectId(req.user._id);

  // Check access
  const { channel } = await checkChannelAccess(channelId, userId);

  // Create message
  const message = await MessageModel.create({
    content,
    author: userId,
    channel: channelId,
    server: channel.server,
    attachments: attachments || [],
    mentions: mentions || [],
    replyTo: replyTo || null,
  });

  // Populate author details
  const populatedMessage = await MessageModel.findById(message._id)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  // Invalidate cache
  await invalidateMessageCache(channelId);

  // Emit socket event to channel
  emitToChannel(channelId, "message:created", {
    message: populatedMessage,
    channelId,
    timestamp: new Date(),
  });

  // Notify mentioned users
  if (mentions && mentions.length > 0) {
    mentions.forEach((mentionedUserId) => {
      emitToUser(mentionedUserId.toString(), "message:mentioned", {
        message: populatedMessage,
        channelId,
        timestamp: new Date(),
      });
    });
  }

  sendCreated(res, populatedMessage, "Message sent successfully");
});

//    Get messages from a channel (paginated)
export const getChannelMessages = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const { page = 1, limit = 50, before } = req.query;
  const userId = validateObjectId(req.user._id);

  // Check access
  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.channelMessages(channelId, page, limit);

  // Try cache first (only if not using 'before' cursor)
  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) {
      return sendSuccess(res, JSON.parse(cached));
    }
  }

  const skip = (page - 1) * limit;
  const query = { channel: channelId };

  // If 'before' cursor is provided, get messages before that message
  if (before) {
    const beforeMessage = await MessageModel.findById(before);
    if (beforeMessage) {
      query.createdAt = { $lt: beforeMessage.createdAt };
    }
  }

  const messages = await MessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip(skip)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean();

  const total = await MessageModel.countDocuments({ channel: channelId });

  const result = {
    messages: messages.reverse(), // Reverse to show oldest first
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
      hasMore: skip + messages.length < total,
    },
  };

  // Cache the result (only if not using cursor)
  if (!before) {
    await pubClient.setex(cacheKey, CACHE_TTL.MESSAGES, JSON.stringify(result));
  }

  sendSuccess(res, result);
});

//    Get a single message by ID
export const getMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.message(messageId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    const message = JSON.parse(cached);
    // Verify access
    await checkChannelAccess(message.channel.toString(), userId);
    return sendSuccess(res, message);
  }

  const message = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .populate("mentions", "username avatar")
    .lean();

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check access
  await checkChannelAccess(message.channel.toString(), userId);

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.MESSAGE, JSON.stringify(message));

  sendSuccess(res, message);
});

//    Update/Edit a message
export const updateMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check if user is the author
  if (message.author.toString() !== userId) {
    // Check if user is admin
    const { membership } = await checkChannelAccess(
      message.channel.toString(),
      userId,
    );
    if (!["owner", "admin"].includes(membership.role)) {
      throw createApiError(403, "You can only edit your own messages");
    }
  }

  message.content = content;
  message.isEdited = true;
  message.editedAt = new Date();

  await message.save();

  const updatedMessage = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .populate("replyTo", "content author")
    .lean();

  // Invalidate cache
  await invalidateMessageCache(message.channel.toString(), messageId);

  // Emit socket event
  emitToChannel(message.channel.toString(), "message:updated", {
    message: updatedMessage,
    timestamp: new Date(),
  });

  sendSuccess(res, updatedMessage, "Message updated successfully");
});

//    Delete a message
export const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check if user is the author
  if (message.author.toString() !== userId) {
    // Check if user is admin
    const { membership } = await checkChannelAccess(
      message.channel.toString(),
      userId,
    );
    if (!["owner", "admin", "moderator"].includes(membership.role)) {
      throw createApiError(403, "You can only delete your own messages");
    }
  }

  const channelId = message.channel.toString();

  await message.deleteOne();

  // Invalidate cache
  await invalidateMessageCache(channelId, messageId);

  // Emit socket event
  emitToChannel(channelId, "message:deleted", {
    messageId,
    channelId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Message deleted successfully");
});

//    Pin/Unpin a message
export const togglePinMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check if user has permission
  const { membership } = await checkChannelAccess(
    message.channel.toString(),
    userId,
  );
  if (!["owner", "admin", "moderator"].includes(membership.role)) {
    throw createApiError(403, "Only admins and moderators can pin messages");
  }

  message.isPinned = !message.isPinned;
  await message.save();

  const updatedMessage = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .lean();

  // Invalidate cache
  await invalidateMessageCache(message.channel.toString(), messageId);

  // Emit socket event
  emitToChannel(message.channel.toString(), "message:pinned", {
    message: updatedMessage,
    isPinned: message.isPinned,
    pinnedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(
    res,
    updatedMessage,
    `Message ${message.isPinned ? "pinned" : "unpinned"} successfully`,
  );
});

//    Get pinned messages in a channel
export const getPinnedMessages = asyncHandler(async (req, res) => {
  const { channelId } = req.params;
  const userId = validateObjectId(req.user._id);

  // Check access
  await checkChannelAccess(channelId, userId);

  const cacheKey = getCacheKey.pinnedMessages(channelId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const pinnedMessages = await MessageModel.find({
    channel: channelId,
    isPinned: true,
  })
    .sort({ createdAt: -1 })
    .populate("author", "username avatar status")
    .lean();

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.PINNED,
    JSON.stringify(pinnedMessages),
  );

  sendSuccess(res, pinnedMessages);
});

//    Add reaction to a message
export const addReaction = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check access
  await checkChannelAccess(message.channel.toString(), userId);

  // Find existing reaction with this emoji
  const existingReaction = message.reactions.find((r) => r.emoji === emoji);

  if (existingReaction) {
    // Check if user already reacted
    if (existingReaction.users.includes(userId)) {
      throw createApiError(400, "You already reacted with this emoji");
    }
    existingReaction.users.push(userId);
  } else {
    // Create new reaction
    message.reactions.push({
      emoji,
      users: [userId],
    });
  }

  await message.save();

  const updatedMessage = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .populate("reactions.users", "username avatar")
    .lean();

  // Invalidate cache
  await invalidateMessageCache(message.channel.toString(), messageId);

  // Emit socket event
  emitToChannel(message.channel.toString(), "message:reactionAdded", {
    messageId,
    emoji,
    userId,
    timestamp: new Date(),
  });

  sendSuccess(res, updatedMessage, "Reaction added successfully");
});

//    Remove reaction from a message
export const removeReaction = asyncHandler(async (req, res) => {
  const { messageId, emoji } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await MessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check access
  await checkChannelAccess(message.channel.toString(), userId);

  // Find reaction
  const reaction = message.reactions.find((r) => r.emoji === emoji);

  if (!reaction) {
    throw createApiError(404, "Reaction not found");
  }

  // Remove user from reaction
  reaction.users = reaction.users.filter((id) => id.toString() !== userId);

  // If no users left, remove the reaction entirely
  if (reaction.users.length === 0) {
    message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
  }

  await message.save();

  const updatedMessage = await MessageModel.findById(messageId)
    .populate("author", "username avatar status")
    .lean();

  // Invalidate cache
  await invalidateMessageCache(message.channel.toString(), messageId);

  // Emit socket event
  emitToChannel(message.channel.toString(), "message:reactionRemoved", {
    messageId,
    emoji,
    userId,
    timestamp: new Date(),
  });

  sendSuccess(res, updatedMessage, "Reaction removed successfully");
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
