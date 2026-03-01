import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import type { IDirectMessage, IUser } from "@/types/models";
import { DirectMessageModel } from "@/models/directMessage.model";
import { UserModel } from "@/models/user.model";
import { pubClient } from "@/config/redis.config";
import { emitToUser } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";

// ─── Cache helpers
const CACHE_TTL = {
  CONVERSATIONS: 300,
  MESSAGES: 300,
  UNREAD: 180,
} as const;

const getCacheKey = {
  conversation: (u1: string, u2: string, page: number, limit: number) => {
    const [a, b] = [u1, u2].sort();
    return `dm:${a}:${b}:${page}:${limit}`;
  },
  conversations: (uid: string) => `user:${uid}:conversations`,
  unreadCount: (uid: string) => `user:${uid}:unread`,
};

const invalidateDMCache = async (user1Id: string, user2Id: string): Promise<void> => {
  const [a, b] = [user1Id, user2Id].sort();
  const keys = await pubClient.keys(`dm:${a}:${b}:*`);
  keys.push(
    getCacheKey.conversations(user1Id),
    getCacheKey.conversations(user2Id),
    getCacheKey.unreadCount(user1Id),
    getCacheKey.unreadCount(user2Id),
  );
  if (keys.length > 0) await pubClient.del(...keys);
};

// ─── Send DM
export const sendDirectMessage = asyncHandler(async (req: Request, res: Response) => {
  const senderId = validateObjectId(req.user!._id);
  const { recipientId } = req.params as { recipientId: string };
  const { content, attachments } = req.body as {
    content: string;
    attachments?: IDirectMessage["attachments"];
  };

  if (senderId === recipientId) {
    throw ApiError.badRequest("Cannot send a message to yourself.");
  }

  // IUser.blockedUsers: Types.ObjectId[]
  const recipient = await UserModel.findById<IUser>(recipientId);
  if (!recipient) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (recipient.blockedUsers?.some((id) => id.toString() === senderId)) {
    throw ApiError.forbidden("You cannot send messages to this user.");
  }

  const sender = await UserModel.findById<IUser>(senderId);
  if (!sender) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (sender.blockedUsers?.some((id) => id.toString() === recipientId)) {
    throw ApiError.forbidden("You have blocked this user.");
  }

  const dm = await DirectMessageModel.create({
    content,
    sender: senderId,
    receiver: recipientId,
    attachments: attachments ?? [],
  });

  const populated = await DirectMessageModel.findById<IDirectMessage>(dm._id)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await invalidateDMCache(senderId, recipientId);

  emitToUser(recipientId, "dm:received", { message: populated, timestamp: new Date() });
  emitToUser(senderId, "dm:sent", { message: populated, timestamp: new Date() });

  sendCreated(res, populated, "Message sent successfully.");
});

// ─── Get conversation (paginated)
export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const userId = validateObjectId(req.params.userId as string);
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "50", 10);
  const before = req.query.before as string | undefined;

  const otherUser = await UserModel.findById<IUser>(userId).lean();
  if (!otherUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  const cacheKey = getCacheKey.conversation(currentUserId, userId, page, limit);

  if (!before) {
    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));
  }

  const skip = (page - 1) * limit;

  // Typed query — IDirectMessage has sender/receiver/createdAt
  type DmFilter = {
    $or: Array<{ sender: string; receiver: string }>;
    createdAt?: { $lt: Date };
  };

  const filter: DmFilter = {
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  };

  if (before) {
    const pivot = await DirectMessageModel.findById(before).lean<IDirectMessage>();
    if (pivot) filter.createdAt = { $lt: pivot.createdAt };
  }

  const messages = await DirectMessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean<IDirectMessage[]>();

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
      // IUser.status: "online" | "offline" | "away" | "dnd"
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

  return sendSuccess(res, result, SUCCESS_MESSAGES.CONVERSATION_FETCHED);
});

// ─── Get all conversations
export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.conversations(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  // Distinct returns ObjectId arrays — convert to strings for Set deduplication
  const sentTo = (await DirectMessageModel.find({ sender: userId }).distinct("receiver")) as Types.ObjectId[];
  const receivedFrom = (await DirectMessageModel.find({ receiver: userId }).distinct("sender")) as Types.ObjectId[];

  const userIds = [...new Set([
    ...sentTo.map((id) => id.toString()),
    ...receivedFrom.map((id) => id.toString()),
  ])];

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
        .lean<IDirectMessage>();

      const unreadCount = await DirectMessageModel.countDocuments({
        sender: otherUserId,
        receiver: userId,
        isRead: false,
      });

      const otherUser = await UserModel.findById<IUser>(otherUserId)
        .select("username avatar status customStatus lastSeen")
        .lean();

      return { user: otherUser, lastMessage, unreadCount };
    }),
  );

  // Sort newest conversation first — use .getTime() to compare Date values
  conversations.sort((a, b) => {
    const tA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tB - tA;
  });

  await pubClient.setex(cacheKey, CACHE_TTL.CONVERSATIONS, JSON.stringify(conversations));

  return sendSuccess(res, conversations, SUCCESS_MESSAGES.CONVERSATIONS_FETCHED);
});

// ─── Mark as read
export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const userId = validateObjectId(req.params.userId as string);

  const result = await DirectMessageModel.updateMany(
    { sender: userId, receiver: currentUserId, isRead: false },
    { $set: { isRead: true } },
  );

  await invalidateDMCache(currentUserId, userId);

  emitToUser(userId, "dm:read", { readBy: currentUserId, timestamp: new Date() });

  return sendSuccess(res, { count: result.modifiedCount }, SUCCESS_MESSAGES.MESSAGE_READ);
});

// ─── Edit DM
export const editDirectMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { content } = req.body as { content: string };
  const userId = validateObjectId(req.user!._id);

  const message = await DirectMessageModel.findById<IDirectMessage>(messageId);
  if (!message) throw ApiError.notFound("Message not found.");

  // IDirectMessage.sender: Types.ObjectId
  if (message.sender.toString() !== userId) {
    throw ApiError.forbidden("You can only edit your own messages.");
  }

  message.content = content;
  message.isEdited = true;
  message.editedAt = new Date();
  await message.save();

  const updated = await DirectMessageModel.findById<IDirectMessage>(messageId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await invalidateDMCache(message.sender.toString(), message.receiver.toString());

  emitToUser(message.receiver.toString(), "dm:updated", { message: updated, timestamp: new Date() });
  emitToUser(userId, "dm:updated", { message: updated, timestamp: new Date() });

  sendSuccess(res, updated, "Message updated successfully.");
});

// ─── Delete DM
export const deleteDirectMessage = asyncHandler(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const userId = validateObjectId(req.user!._id);

  const message = await DirectMessageModel.findById<IDirectMessage>(messageId);
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

  return sendSuccess(res, null, SUCCESS_MESSAGES.MESSAGE_DELETED);
});

// ─── Unread count
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
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

  return sendSuccess(res, result, SUCCESS_MESSAGES.UNREAD_COUNT);
});

// ─── Delete conversation
export const deleteConversation = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const userId = validateObjectId(req.params.userId as string);

  await DirectMessageModel.deleteMany({
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  });

  await invalidateDMCache(currentUserId, userId);

  return sendSuccess(res, null, SUCCESS_MESSAGES.CONVERSATION_DELETED);
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