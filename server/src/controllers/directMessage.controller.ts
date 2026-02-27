import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { DirectMessageModel } from "../models/directMessage.model.js";
import { UserModel } from "../models/user.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToUser } from "../socket/socketHandler.js";
import { validateObjectId } from "../utils/validateObjId.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL = {
  CONVERSATIONS: 300,
  MESSAGES: 300,
  UNREAD: 180,
} as const;

const getCacheKey = {
  conversation: (user1Id: string, user2Id: string, page: number, limit: number): string => {
    const [a, b] = [user1Id, user2Id].sort();
    return `dm:${a}:${b}:${page}:${limit}`;
  },
  conversations: (userId: string): string => `user:${userId}:conversations`,
  unreadCount: (userId: string): string => `user:${userId}:unread`,
};

const invalidateDMCache = async (user1Id: string, user2Id: string): Promise<void> => {
  const [a, b] = [user1Id, user2Id].sort();
  const conversationKeys = await pubClient.keys(`dm:${a}:${b}:*`);
  const keysToDelete = [
    ...conversationKeys,
    getCacheKey.conversations(user1Id),
    getCacheKey.conversations(user2Id),
    getCacheKey.unreadCount(user1Id),
    getCacheKey.unreadCount(user2Id),
  ];
  if (keysToDelete.length > 0) await pubClient.del(...keysToDelete);
};

// ─── Send DM ──────────────────────────────────────────────────────────────────

export const sendDirectMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const senderId = validateObjectId(req.user._id);
  const { recipientId } = req.params;
  const { content, attachments } = req.body as {
    content: string;
    attachments?: unknown[];
  };

  if (senderId === recipientId) {
    throw ApiError.badRequest("Cannot send a message to yourself.");
  }

  const recipient = await UserModel.findById(recipientId);
  if (!recipient) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (recipient.blockedUsers?.some((id) => id.toString() === senderId)) {
    throw ApiError.forbidden("You cannot send messages to this user.");
  }

  const sender = await UserModel.findById(senderId);
  if (!sender) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
  if (sender.blockedUsers?.some((id) => id.toString() === recipientId)) {
    throw ApiError.forbidden("You have blocked this user.");
  }

  const directMessage = await DirectMessageModel.create({
    content,
    sender: senderId,
    receiver: recipientId,
    attachments: attachments ?? [],
  });

  const populatedMessage = await DirectMessageModel.findById(directMessage._id)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await invalidateDMCache(senderId, recipientId);

  emitToUser(recipientId, "dm:received", { message: populatedMessage, timestamp: new Date() });
  emitToUser(senderId, "dm:sent", { message: populatedMessage, timestamp: new Date() });

  sendCreated(res, populatedMessage, "Message sent successfully.");
});

// ─── Get conversation (paginated) ─────────────────────────────────────────────

export const getConversation = asyncHandler(async (req: AuthReq, res: Response) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;
  // FIX: query params are always strings — parse explicitly
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "50", 10);
  const before = req.query.before as string | undefined;

  const otherUser = await UserModel.findById(userId);
  if (!otherUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  const cacheKey = getCacheKey.conversation(currentUserId, userId, page, limit);

  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));
  }

  const skip = (page - 1) * limit;

  // FIX: original mutated a shared query object then added createdAt — build properly typed
  interface DmQuery {
    $or: Array<{ sender: string; receiver: string }>;
    createdAt?: { $lt: Date };
  }

  const query: DmQuery = {
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  };

  if (before) {
    const beforeMessage = await DirectMessageModel.findById(before);
    if (beforeMessage) query.createdAt = { $lt: beforeMessage.createdAt as Date };
  }

  const messages = await DirectMessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
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
    messages: messages.reverse(),
    otherUser: {
      _id: otherUser._id,
      username: otherUser.username,
      avatar: otherUser.avatar,
      status: otherUser.status,
      customStatus: otherUser.customStatus,
    },
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

// ─── Get all conversations ────────────────────────────────────────────────────

export const getConversations = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.conversations(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const sentTo = await DirectMessageModel.find({ sender: userId }).distinct("receiver");
  const receivedFrom = await DirectMessageModel.find({ receiver: userId }).distinct("sender");
  const userIds = [...new Set([...sentTo.map(String), ...receivedFrom.map(String)])];

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

      const unreadCount = await DirectMessageModel.countDocuments({
        sender: otherUserId,
        receiver: userId,
        isRead: false,
      });

      const otherUser = await UserModel.findById(otherUserId)
        .select("username avatar status customStatus lastSeen")
        .lean();

      return { user: otherUser, lastMessage, unreadCount };
    }),
  );

  // FIX: original subtracted Date objects directly — must call .getTime()
  conversations.sort((a, b) => {
    const tA = a.lastMessage ? new Date(a.lastMessage.createdAt as Date).getTime() : 0;
    const tB = b.lastMessage ? new Date(b.lastMessage.createdAt as Date).getTime() : 0;
    return tB - tA;
  });

  await pubClient.setex(cacheKey, CACHE_TTL.CONVERSATIONS, JSON.stringify(conversations));

  sendSuccess(res, conversations);
});

// ─── Mark as read ─────────────────────────────────────────────────────────────

export const markAsRead = asyncHandler(async (req: AuthReq, res: Response) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  const result = await DirectMessageModel.updateMany(
    { sender: userId, receiver: currentUserId, isRead: false },
    { $set: { isRead: true } },
  );

  await invalidateDMCache(currentUserId, userId);

  emitToUser(userId, "dm:read", { readBy: currentUserId, timestamp: new Date() });

  sendSuccess(res, { count: result.modifiedCount }, "Messages marked as read.");
});

// ─── Edit DM ──────────────────────────────────────────────────────────────────

export const editDirectMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const { content } = req.body as { content: string };
  const userId = validateObjectId(req.user._id);

  const message = await DirectMessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  if (message.sender.toString() !== userId) {
    throw ApiError.forbidden("You can only edit your own messages.");
  }

  message.content = content;
  message.isEdited = true;
  message.editedAt = new Date();
  await message.save();

  const updated = await DirectMessageModel.findById(messageId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await invalidateDMCache(message.sender.toString(), message.receiver.toString());

  emitToUser(message.receiver.toString(), "dm:updated", { message: updated, timestamp: new Date() });
  emitToUser(userId, "dm:updated", { message: updated, timestamp: new Date() });

  sendSuccess(res, updated, "Message updated successfully.");
});

// ─── Delete DM ────────────────────────────────────────────────────────────────

export const deleteDirectMessage = asyncHandler(async (req: AuthReq, res: Response) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user._id);

  const message = await DirectMessageModel.findById(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  if (message.sender.toString() !== userId) {
    throw ApiError.forbidden("You can only delete your own messages.");
  }

  const receiverId = message.receiver.toString();
  await message.deleteOne();
  await invalidateDMCache(userId, receiverId);

  const payload = { messageId, deletedBy: userId, timestamp: new Date() };
  emitToUser(receiverId, "dm:deleted", payload);
  emitToUser(userId, "dm:deleted", payload);

  sendSuccess(res, null, "Message deleted successfully.");
});

// ─── Unread count ─────────────────────────────────────────────────────────────

export const getUnreadCount = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.unreadCount(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const total = await DirectMessageModel.countDocuments({ receiver: userId, isRead: false });

  const byConversation = await DirectMessageModel.aggregate([
    { $match: { receiver: userId, isRead: false } },
    { $group: { _id: "$sender", count: { $sum: 1 } } },
  ]);

  const result = { total, byConversation };
  await pubClient.setex(cacheKey, CACHE_TTL.UNREAD, JSON.stringify(result));

  sendSuccess(res, result);
});

// ─── Delete conversation ──────────────────────────────────────────────────────

export const deleteConversation = asyncHandler(async (req: AuthReq, res: Response) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  await DirectMessageModel.deleteMany({
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  });

  await invalidateDMCache(currentUserId, userId);

  sendSuccess(res, null, "Conversation deleted successfully.");
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