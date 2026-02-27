import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess, sendCreated } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { FriendRequestModel } from "../models/friendRequest.model.js";
import { UserModel } from "../models/user.model.js";
import { pubClient } from "../config/redis.config.js";
import { emitToUser } from "../socket/socketHandler.js";

const CACHE_TTL = {
  REQUESTS: 600, // 10 minutes
};

const getCacheKey = {
  pendingRequests: (userId) => `user:${userId}:friend-requests:pending`,
  sentRequests: (userId) => `user:${userId}:friend-requests:sent`,
};

const invalidateFriendRequestCache = async (userId) => {
  const keys = [
    getCacheKey.pendingRequests(userId),
    getCacheKey.sentRequests(userId),
    `user:${userId}:friends`, // Also invalidate friends cache
  ];

  await pubClient.del(...keys);
};

//    Send a friend request
export const sendFriendRequest = asyncHandler(async (req, res) => {
  const senderId = validateObjectId(req.user._id);
  const { userId: receiverId } = req.params;

  if (senderId === receiverId) {
    throw createApiError(400, "Cannot send friend request to yourself");
  }

  // Check if receiver exists
  const receiver = await UserModel.findById(receiverId);
  if (!receiver) {
    throw createApiError(404, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const sender = await UserModel.findById(senderId);

  // Check if already friends
  if (sender.friends.includes(receiverId)) {
    throw createApiError(400, "You are already friends with this user");
  }

  // Check if blocked
  if (receiver.blockedUsers && receiver.blockedUsers.includes(senderId)) {
    throw createApiError(403, "Cannot send friend request to this user");
  }

  if (sender.blockedUsers && sender.blockedUsers.includes(receiverId)) {
    throw createApiError(403, "You have blocked this user");
  }

  // Check if request already exists (in any state)
  const existingRequest = await FriendRequestModel.findOne({
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId },
    ],
  });

  if (existingRequest) {
    if (existingRequest.status === "pending") {
      throw createApiError(400, "Friend request already sent");
    } else if (existingRequest.status === "declined") {
      // Allow resending after decline
      existingRequest.sender = senderId;
      existingRequest.receiver = receiverId;
      existingRequest.status = "pending";
      await existingRequest.save();

      // Populate for response
      const populatedRequest = await FriendRequestModel.findById(
        existingRequest._id,
      )
        .populate("sender", "username avatar status")
        .populate("receiver", "username avatar status")
        .lean();

      // Invalidate caches
      await Promise.all([
        invalidateFriendRequestCache(senderId),
        invalidateFriendRequestCache(receiverId),
      ]);

      // Emit socket event
      emitToUser(receiverId, "friendRequest:received", {
        request: populatedRequest,
        timestamp: new Date(),
      });

      return sendSuccess(
        res,
        populatedRequest,
        "Friend request sent successfully",
      );
    }
  }

  // Create new friend request
  const friendRequest = await FriendRequestModel.create({
    sender: senderId,
    receiver: receiverId,
    status: "pending",
  });

  const populatedRequest = await FriendRequestModel.findById(friendRequest._id)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  // Invalidate caches
  await Promise.all([
    invalidateFriendRequestCache(senderId),
    invalidateFriendRequestCache(receiverId),
  ]);

  // Emit socket event to receiver
  emitToUser(receiverId, "friendRequest:received", {
    request: populatedRequest,
    timestamp: new Date(),
  });

  sendCreated(res, populatedRequest, "Friend request sent successfully");
});

//    Accept a friend request
export const acceptFriendRequest = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);

  if (!friendRequest) {
    throw createApiError(404, "Friend request not found");
  }

  // Verify user is the receiver
  if (friendRequest.receiver.toString() !== userId) {
    throw createApiError(403, "You can only accept requests sent to you");
  }

  // Check if already accepted
  if (friendRequest.status === "accepted") {
    throw createApiError(400, "Friend request already accepted");
  }

  // Update request status
  friendRequest.status = "accepted";
  await friendRequest.save();

  // Add to both users' friends lists
  const sender = await UserModel.findById(friendRequest.sender);
  const receiver = await UserModel.findById(friendRequest.receiver);

  sender.friends.push(receiver._id);
  receiver.friends.push(sender._id);

  await Promise.all([sender.save(), receiver.save()]);

  const populatedRequest = await FriendRequestModel.findById(requestId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  // Invalidate caches
  await Promise.all([
    invalidateFriendRequestCache(sender._id.toString()),
    invalidateFriendRequestCache(receiver._id.toString()),
  ]);

  // Emit socket events
  emitToUser(sender._id.toString(), "friendRequest:accepted", {
    request: populatedRequest,
    newFriend: {
      _id: receiver._id,
      username: receiver.username,
      avatar: receiver.avatar,
      status: receiver.status,
    },
    timestamp: new Date(),
  });

  emitToUser(receiver._id.toString(), "friend:added", {
    newFriend: {
      _id: sender._id,
      username: sender.username,
      avatar: sender.avatar,
      status: sender.status,
    },
    timestamp: new Date(),
  });

  sendSuccess(res, populatedRequest, "Friend request accepted");
});

//    Decline a friend request
export const declineFriendRequest = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);

  if (!friendRequest) {
    throw createApiError(404, "Friend request not found");
  }

  // Verify user is the receiver
  if (friendRequest.receiver.toString() !== userId) {
    throw createApiError(403, "You can only decline requests sent to you");
  }

  friendRequest.status = "declined";
  await friendRequest.save();

  const populatedRequest = await FriendRequestModel.findById(requestId)
    .populate("sender", "username avatar status")
    .populate("receiver", "username avatar status")
    .lean();

  // Invalidate caches
  await Promise.all([
    invalidateFriendRequestCache(friendRequest.sender.toString()),
    invalidateFriendRequestCache(userId),
  ]);

  // Emit socket event to sender
  emitToUser(friendRequest.sender.toString(), "friendRequest:declined", {
    request: populatedRequest,
    timestamp: new Date(),
  });

  sendSuccess(res, populatedRequest, "Friend request declined");
});

//    Cancel a sent friend request
export const cancelFriendRequest = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { requestId } = req.params;

  const friendRequest = await FriendRequestModel.findById(requestId);

  if (!friendRequest) {
    throw createApiError(404, "Friend request not found");
  }

  // Verify user is the sender
  if (friendRequest.sender.toString() !== userId) {
    throw createApiError(403, "You can only cancel requests you sent");
  }

  const receiverId = friendRequest.receiver.toString();

  await friendRequest.deleteOne();

  // Invalidate caches
  await Promise.all([
    invalidateFriendRequestCache(userId),
    invalidateFriendRequestCache(receiverId),
  ]);

  // Emit socket event to receiver
  emitToUser(receiverId, "friendRequest:cancelled", {
    requestId,
    senderId: userId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Friend request cancelled");
});

//    Get pending friend requests (received)
export const getPendingRequests = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.pendingRequests(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const pendingRequests = await FriendRequestModel.find({
    receiver: userId,
    status: "pending",
  })
    .populate("sender", "username avatar status bio")
    .sort({ createdAt: -1 })
    .lean();

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.REQUESTS,
    JSON.stringify(pendingRequests),
  );

  sendSuccess(res, pendingRequests);
});

//    Get sent friend requests
export const getSentRequests = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.sentRequests(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const sentRequests = await FriendRequestModel.find({
    sender: userId,
    status: "pending",
  })
    .populate("receiver", "username avatar status bio")
    .sort({ createdAt: -1 })
    .lean();

  // Cache the result
  await pubClient.setex(
    cacheKey,
    CACHE_TTL.REQUESTS,
    JSON.stringify(sentRequests),
  );

  sendSuccess(res, sentRequests);
});

//    Get all friend requests (sent and received)
export const getAllFriendRequests = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);

  const [received, sent] = await Promise.all([
    FriendRequestModel.find({
      receiver: userId,
      status: "pending",
    })
      .populate("sender", "username avatar status bio")
      .sort({ createdAt: -1 })
      .lean(),

    FriendRequestModel.find({
      sender: userId,
      status: "pending",
    })
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
