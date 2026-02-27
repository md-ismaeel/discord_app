import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { DirectMessageModel } from "../models/directMessage.model.js";
import { UserModel } from "../models/user.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToUser } from "../socket/socketHandler.js";

const CACHE_TTL = {
  CONVERSATIONS: 300, // 5 minutes
  MESSAGES: 300, // 5 minutes
  UNREAD: 180, // 3 minutes
};

const getCacheKey = {
  conversation: (user1Id, user2Id, page, limit) => {
    const sortedIds = [user1Id, user2Id].sort();
    return `dm:${sortedIds[0]}:${sortedIds[1]}:${page}:${limit}`;
  },
  conversations: (userId) => `user:${userId}:conversations`,
  unreadCount: (userId) => `user:${userId}:unread`,
};

const invalidateDMCache = async (user1Id, user2Id) => {
  const sortedIds = [user1Id, user2Id].sort();

  // Delete all paginated conversation caches
  const conversationKeys = await pubClient.keys(
    `dm:${sortedIds[0]}:${sortedIds[1]}:*`,
  );
  const keysToDelete = [
    ...conversationKeys,
    getCacheKey.conversations(user1Id),
    getCacheKey.conversations(user2Id),
    getCacheKey.unreadCount(user1Id),
    getCacheKey.unreadCount(user2Id),
  ];

  if (keysToDelete.length > 0) {
    await pubClient.del(...keysToDelete);
  }
};

//    Send a direct message
export const sendDirectMessage = asyncHandler(async (req, res) => {
  const senderId = validateObjectId(req.user._id);
  const { recipientId } = req.params;
  const { content, attachments } = req.body;

  if (senderId === recipientId) {
    throw createApiError(400, "Cannot send message to yourself");
  }

  // Check if recipient exists
  const recipient = await UserModel.findById(recipientId);
  if (!recipient) {
    throw createApiError(404, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Check if sender is blocked by recipient
  if (recipient.blockedUsers && recipient.blockedUsers.includes(senderId)) {
    throw createApiError(403, "You cannot send messages to this user");
  }

  // Check if recipient is blocked by sender
  const sender = await UserModel.findById(senderId);
  if (sender.blockedUsers && sender.blockedUsers.includes(recipientId)) {
    throw createApiError(403, "You have blocked this user");
  }

  // Create direct message
  const directMessage = await DirectMessageModel.create({
    content,
    sender: senderId,
    receiver: recipientId,
    attachments: attachments || [],
  });

  // Populate sender details
  const populatedMessage = await DirectMessageModel.findById(directMessage._id)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  // Invalidate cache
  await invalidateDMCache(senderId, recipientId);

  // Emit socket event to recipient
  emitToUser(recipientId, "dm:received", {
    message: populatedMessage,
    timestamp: new Date(),
  });

  // Emit to sender (for multi-device sync)
  emitToUser(senderId, "dm:sent", {
    message: populatedMessage,
    timestamp: new Date(),
  });

  sendCreated(res, populatedMessage, "Message sent successfully");
});

//    Get conversation between two users (paginated)
export const getConversation = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;
  const { page = 1, limit = 50, before } = req.query;

  // Verify other user exists
  const otherUser = await UserModel.findById(userId);
  if (!otherUser) {
    throw createApiError(404, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const cacheKey = getCacheKey.conversation(currentUserId, userId, page, limit);

  // Try cache first (only if not using 'before' cursor)
  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) {
      return sendSuccess(res, JSON.parse(cached));
    }
  }

  const skip = (page - 1) * limit;
  const query = {
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  };

  // If 'before' cursor is provided
  if (before) {
    const beforeMessage = await DirectMessageModel.findById(before);
    if (beforeMessage) {
      query.createdAt = { $lt: beforeMessage.createdAt };
    }
  }

  const messages = await DirectMessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip(skip)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  const total = await DirectMessageModel.countDocuments({
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  });

  const result = {
    messages: messages.reverse(), // Reverse to show oldest first
    otherUser: {
      _id: otherUser._id,
      username: otherUser.username,
      avatar: otherUser.avatar,
      status: otherUser.status,
      customStatus: otherUser.customStatus,
    },
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

//    Get all conversations for current user
export const getConversations = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.conversations(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  // Get all unique users the current user has messaged with
  const sentMessages = await DirectMessageModel.find({ sender: userId })
    .distinct("receiver")
    .lean();

  const receivedMessages = await DirectMessageModel.find({ receiver: userId })
    .distinct("sender")
    .lean();

  // Combine and get unique user IDs
  const userIds = [...new Set([...sentMessages, ...receivedMessages])];

  // Get last message with each user
  const conversations = await Promise.all(
    userIds.map(async (otherUserId) => {
      const lastMessage = await DirectMessageModel.findOne({
        $or: [
          { sender: userId, receiver: otherUserId },
          { sender: otherUserId, receiver: userId },
        ],
      })
        .sort({ createdAt: -1 })
        .populate("sender", "username avatar status")
        .populate("receiver", "username avatar status")
        .lean();

      // Count unread messages from this user
      const unreadCount = await DirectMessageModel.countDocuments({
        sender: otherUserId,
        receiver: userId,
        isRead: false,
      });

      // Get other user info
      const otherUser = await UserModel.findById(otherUserId)
        .select("username avatar status customStatus lastSeen")
        .lean();

      return {
        user: otherUser,
        lastMessage,
        unreadCount,
      };
    }),
  );

  // Sort by last message timestamp
  conversations.sort((a, b) => {
    const timeA = a.lastMessage
      ? new Date(a.lastMessage.createdAt)
      : new Date(0);
    const timeB = b.lastMessage
      ? new Date(b.lastMessage.createdAt)
      : new Date(0);
    return timeB - timeA;
  });

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.CONVERSATIONS,
    JSON.stringify(conversations),
  );

  sendSuccess(res, conversations);
});

//    Mark messages as read
export const markAsRead = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  // Mark all unread messages from this user as read
  const result = await DirectMessageModel.updateMany(
    {
      sender: userId,
      receiver: currentUserId,
      isRead: false,
    },
    {
      $set: { isRead: true },
    },
  );

  // Invalidate cache
  await invalidateDMCache(currentUserId, userId);

  // Emit socket event to sender (so they know their messages were read)
  emitToUser(userId, "dm:read", {
    readBy: currentUserId,
    timestamp: new Date(),
  });

  sendSuccess(res, { count: result.modifiedCount }, "Messages marked as read");
});

//    Edit a direct message
export const editDirectMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = validateObjectId(req.user._id);

  const message = await DirectMessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check if user is the sender
  if (message.sender.toString() !== userId) {
    throw createApiError(403, "You can only edit your own messages");
  }

  message.content = content;
  message.isEdited = true;
  message.editedAt = new Date();

  await message.save();

  const updatedMessage = await DirectMessageModel.findById(messageId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  // Invalidate cache
  await invalidateDMCache(
    message.sender.toString(),
    message.receiver.toString(),
  );

  // Emit socket events
  emitToUser(message.receiver.toString(), "dm:updated", {
    message: updatedMessage,
    timestamp: new Date(),
  });

  emitToUser(userId, "dm:updated", {
    message: updatedMessage,
    timestamp: new Date(),
  });

  sendSuccess(res, updatedMessage, "Message updated successfully");
});

//    Delete a direct message
export const deleteDirectMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await DirectMessageModel.findById(messageId);

  if (!message) {
    throw createApiError(404, "Message not found");
  }

  // Check if user is the sender
  if (message.sender.toString() !== userId) {
    throw createApiError(403, "You can only delete your own messages");
  }

  const receiverId = message.receiver.toString();

  await message.deleteOne();

  // Invalidate cache
  await invalidateDMCache(userId, receiverId);

  // Emit socket events
  emitToUser(receiverId, "dm:deleted", {
    messageId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  emitToUser(userId, "dm:deleted", {
    messageId,
    deletedBy: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Message deleted successfully");
});

//    Get unread message count
export const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.unreadCount(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const unreadCount = await DirectMessageModel.countDocuments({
    receiver: userId,
    isRead: false,
  });

  // Get unread count per conversation
  const unreadBySender = await DirectMessageModel.aggregate([
    {
      $match: {
        receiver: userId,
        isRead: false,
      },
    },
    {
      $group: {
        _id: "$sender",
        count: { $sum: 1 },
      },
    },
  ]);

  const result = {
    total: unreadCount,
    byConversation: unreadBySender,
  };

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.UNREAD, JSON.stringify(result));

  sendSuccess(res, result);
});

//    Delete entire conversation with a user
export const deleteConversation = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  // Delete all messages between the two users
  await DirectMessageModel.deleteMany({
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  });

  // Invalidate cache
  await invalidateDMCache(currentUserId, userId);

  sendSuccess(res, null, "Conversation deleted successfully");
});

export default {
  sendDirectMessage,
  getConversation,
  getConversations,
  markAsRead,
  editDirectMessage,
  deleteDirectMessage,
  getUnreadCount,
  deleteConversation,
};
