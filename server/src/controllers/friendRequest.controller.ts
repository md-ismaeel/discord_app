import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { FriendRequestModel } from "../models/friendRequest.model.js";
import { UserModel } from "../models/user.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToUser } from "../socket/socketHandler.js";
import { validateObjectId } from "../utils/validateObjId.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  user: { _id: Types.ObjectId };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_TTL = { REQUESTS: 600 } as const;

const getCacheKey = {
  pendingRequests: (userId: string): string => `user:${userId}:friend-requests:pending`,
  sentRequests: (userId: string): string => `user:${userId}:friend-requests:sent`,
};

const invalidateFriendRequestCache = async (userId: string): Promise<void> => {
  await pubClient.del(
    getCacheKey.pendingRequests(userId),
    getCacheKey.sentRequests(userId),
    `user:${userId}:friends`,
  );
};

// ─── Send friend request ──────────────────────────────────────────────────────

export const sendFriendRequest = asyncHandler(async (req: AuthReq, res: Response) => {
  const senderId = validateObjectId(req.user._id);
  const { userId: receiverId } = req.params;

  if (senderId === receiverId) {
    throw ApiError.badRequest("Cannot send a friend request to yourself.");
  }

  const receiver = await UserModel.findById(receiverId);
  if (!receiver) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  // FIX: original did findById without null guard — could throw on .friends access
  const sender = await UserModel.findById(senderId);
  if (!sender) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (sender.friends.some((id) => id.toString() === receiverId)) {
    throw ApiError.badRequest("You are already friends with this user.");
  }

  if (receiver.blockedUsers?.some((id) => id.toString() === senderId)) {
    throw ApiError.forbidden("Cannot send a friend request to this user.");
  }
  if (sender.blockedUsers?.some((id) => id.toString() === receiverId)) {
    throw ApiError.forbidden("You have blocked this user.");
  }

  const existingRequest = await FriendRequestModel.findOne({
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId },
    ],
  });

  if (existingRequest) {
    if (existingRequest.status === "pending") {
      throw ApiError.badRequest("Friend request already sent.");
    }
    if (existingRequest.status === "declined") {
      // Allow resending after a decline
      existingRequest.sender = senderId as unknown as Types.ObjectId;
      existingRequest.receiver = receiverId as unknown as Types.ObjectId;
      existingRequest.status = "pending";
      await existingRequest.save();

      const populated = await FriendRequestModel.findById(existingRequest._id)
        .populate("sender", "username avatar status")
        .populate("receiver", "username avatar status")
        .lean();

      await Promise.all([
        invalidateFriendRequestCache(senderId),
        invalidateFriendRequestCache(receiverId),
      ]);

      emitToUser(receiverId, "friendRequest:received", { request: populated, timestamp: new Date() });
      return sendSuccess(res, populated, "Friend request sent successfully.");
    }
  }

  const friendRequest = await FriendRequestModel.create({
    sender: senderId,
    receiver: receiverId,
    status: "pending",
  });

  const populated = await FriendRequestModel.findById(friendRequest._id)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await Promise.all([
    invalidateFriendRequestCache(senderId),
    invalidateFriendRequestCache(receiverId),
  ]);

  emitToUser(receiverId, "friendRequest:received", { request: populated, timestamp: new Date() });

  sendCreated(res, populated, "Friend request sent successfully.");
});

// ─── Accept friend request ────────────────────────────────────────────────────

export const acceptFriendRequest = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);
  if (!friendRequest) throw ApiError.notFound("Friend request not found.");

  if (friendRequest.receiver.toString() !== userId) {
    throw ApiError.forbidden("You can only accept requests sent to you.");
  }
  if (friendRequest.status === "accepted") {
    throw ApiError.badRequest("Friend request already accepted.");
  }

  friendRequest.status = "accepted";
  await friendRequest.save();

  // FIX: original accessed sender/receiver without null guards
  const sender = await UserModel.findById(friendRequest.sender);
  const receiver = await UserModel.findById(friendRequest.receiver);
  if (!sender || !receiver) throw ApiError.internal("User not found during friend acceptance.");

  sender.friends.push(receiver._id);
  receiver.friends.push(sender._id);
  await Promise.all([sender.save(), receiver.save()]);

  const populated = await FriendRequestModel.findById(requestId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await Promise.all([
    invalidateFriendRequestCache(sender._id.toString()),
    invalidateFriendRequestCache(receiver._id.toString()),
  ]);

  emitToUser(sender._id.toString(), "friendRequest:accepted", {
    request: populated,
    newFriend: { _id: receiver._id, username: receiver.username, avatar: receiver.avatar, status: receiver.status },
    timestamp: new Date(),
  });

  emitToUser(receiver._id.toString(), "friend:added", {
    newFriend: { _id: sender._id, username: sender.username, avatar: sender.avatar, status: sender.status },
    timestamp: new Date(),
  });

  sendSuccess(res, populated, "Friend request accepted.");
});

// ─── Decline friend request ───────────────────────────────────────────────────

export const declineFriendRequest = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);
  if (!friendRequest) throw ApiError.notFound("Friend request not found.");

  if (friendRequest.receiver.toString() !== userId) {
    throw ApiError.forbidden("You can only decline requests sent to you.");
  }

  friendRequest.status = "declined";
  await friendRequest.save();

  const populated = await FriendRequestModel.findById(requestId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  await Promise.all([
    invalidateFriendRequestCache(friendRequest.sender.toString()),
    invalidateFriendRequestCache(userId),
  ]);

  emitToUser(friendRequest.sender.toString(), "friendRequest:declined", {
    request: populated,
    timestamp: new Date(),
  });

  sendSuccess(res, populated, "Friend request declined.");
});

// ─── Cancel friend request ────────────────────────────────────────────────────

export const cancelFriendRequest = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);
  if (!friendRequest) throw ApiError.notFound("Friend request not found.");

  if (friendRequest.sender.toString() !== userId) {
    throw ApiError.forbidden("You can only cancel requests you sent.");
  }

  const receiverId = friendRequest.receiver.toString();
  await friendRequest.deleteOne();

  await Promise.all([
    invalidateFriendRequestCache(userId),
    invalidateFriendRequestCache(receiverId),
  ]);

  emitToUser(receiverId, "friendRequest:cancelled", {
    requestId,
    senderId: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Friend request cancelled.");
});

// ─── Get pending requests ─────────────────────────────────────────────────────

export const getPendingRequests = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.pendingRequests(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const pending = await FriendRequestModel.find({ receiver: userId, status: "pending" })
    .populate("sender", "username avatar status bio")
    .sort({ createdAt: -1 })
    .lean();

  await pubClient.setex(cacheKey, CACHE_TTL.REQUESTS, JSON.stringify(pending));

  sendSuccess(res, pending);
});

// ─── Get sent requests ────────────────────────────────────────────────────────

export const getSentRequests = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.sentRequests(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const sent = await FriendRequestModel.find({ sender: userId, status: "pending" })
    .populate("receiver", "username avatar status bio")
    .sort({ createdAt: -1 })
    .lean();

  await pubClient.setex(cacheKey, CACHE_TTL.REQUESTS, JSON.stringify(sent));

  sendSuccess(res, sent);
});

// ─── Get all requests ─────────────────────────────────────────────────────────

export const getAllFriendRequests = asyncHandler(async (req: AuthReq, res: Response) => {
  const userId = validateObjectId(req.user._id);

  const [received, sent] = await Promise.all([
    FriendRequestModel.find({ receiver: userId, status: "pending" })
      .populate("sender", "username avatar status bio")
      .sort({ createdAt: -1 })
      .lean(),
    FriendRequestModel.find({ sender: userId, status: "pending" })
      .populate("receiver", "username avatar status bio")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  sendSuccess(res, {
    received,
    sent,
    totalReceived: received.length,
    totalSent: sent.length,
  });
});

export default {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  getPendingRequests,
  getSentRequests,
  getAllFriendRequests,
};