import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import type { IFriendRequest, IUser } from "@/types/models";
import { FriendRequestModel } from "@/models/friendRequest.model";
import { UserModel } from "@/models/user.model";
import { pubClient } from "@/config/redis.config";
import { emitToUser } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";

// ─── Cache helpers ────────────────────────────────────────────────────────────
const CACHE_TTL = { REQUESTS: 600 } as const;

const getCacheKey = {
  pending: (uid: string) => `user:${uid}:friend-requests:pending`,
  sent: (uid: string) => `user:${uid}:friend-requests:sent`,
};

const invalidateCache = async (userId: string): Promise<void> => {
  await pubClient.del(
    getCacheKey.pending(userId),
    getCacheKey.sent(userId),
    `user:${userId}:friends`,
  );
};

// ─── Send friend request
export const sendFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const senderId = validateObjectId(req.user!._id);
    const receiverId = validateObjectId(req.params.userId as string);

    if (senderId === receiverId) {
      throw ApiError.badRequest(SUCCESS_MESSAGES.REQUESTED_TO_YOURSELF);
    }

    const receiver = await UserModel.findById<IUser>(receiverId);
    if (!receiver) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

    const sender = await UserModel.findById<IUser>(senderId);
    if (!sender) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

    // IUser.friends: Types.ObjectId[] — must compare as strings
    if (sender.friends.some((id) => id.toString() === receiverId)) {
      throw ApiError.badRequest("You are already friends with this user.");
    }

    // IUser.blockedUsers: Types.ObjectId[]
    if (receiver.blockedUsers?.some((id) => id.toString() === senderId)) {
      throw ApiError.forbidden("Cannot send a friend request to this user.");
    }
    if (sender.blockedUsers?.some((id) => id.toString() === receiverId)) {
      throw ApiError.forbidden("You have blocked this user.");
    }

    const existing = await FriendRequestModel.findOne<IFriendRequest>({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    });

    if (existing) {
      // IFriendRequest.status: "pending" | "accepted" | "declined"
      if (existing.status === "pending") {
        throw ApiError.badRequest("Friend request already sent.");
      }

      if (existing.status === "declined") {
        // Reuse the existing document — reset to pending
        existing.sender = senderId as unknown as Types.ObjectId;
        existing.receiver = receiverId as unknown as Types.ObjectId;
        existing.status = "pending";
        await existing.save();

        const populated = await FriendRequestModel.findById(existing._id)
          .populate("sender", "username avatar status")
          .populate("receiver", "username avatar status")
          .lean<IFriendRequest>();

        await Promise.all([
          invalidateCache(senderId),
          invalidateCache(receiverId),
        ]);

        emitToUser(receiverId, "friendRequest:received", {
          request: populated,
          timestamp: new Date(),
        });

        return sendSuccess(res, populated, "Friend request sent successfully.");
      }
    }

    const request = await FriendRequestModel.create({
      sender: senderId,
      receiver: receiverId,
      status: "pending",
    });

    const populated = await FriendRequestModel.findById(request._id)
      .populate("sender", "username avatar status")
      .populate("receiver", "username avatar status")
      .lean<IFriendRequest>();

    await Promise.all([invalidateCache(senderId), invalidateCache(receiverId)]);

    emitToUser(receiverId, "friendRequest:received", {
      request: populated,
      timestamp: new Date(),
    });

    return sendCreated(res, populated, SUCCESS_MESSAGES.FRIEND_REQUEST_SENT);
  },
);

// ─── Accept friend request
export const acceptFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);
    const { requestId } = req.params;

    const request =
      await FriendRequestModel.findById<IFriendRequest>(requestId);
    if (!request) throw ApiError.notFound("Friend request not found.");

    if (request.receiver.toString() !== userId) {
      throw ApiError.forbidden("You can only accept requests sent to you.");
    }
    if (request.status === "accepted") {
      throw ApiError.badRequest("Friend request already accepted.");
    }

    request.status = "accepted";
    await request.save();

    // Fetch both users to mutate their friends arrays
    const [sender, receiver] = await Promise.all([
      UserModel.findById<IUser>(request.sender),
      UserModel.findById<IUser>(request.receiver),
    ]);
    if (!sender || !receiver) {
      throw ApiError.internal("User not found during friend acceptance.");
    }

    // IUser.friends: Types.ObjectId[]
    sender.friends.push(receiver._id);
    receiver.friends.push(sender._id);
    await Promise.all([sender.save(), receiver.save()]);

    const populated = await FriendRequestModel.findById(requestId)
      .populate("sender", "username avatar status")
      .populate("receiver", "username avatar status")
      .lean<IFriendRequest>();

    await Promise.all([
      invalidateCache(sender._id.toString()),
      invalidateCache(receiver._id.toString()),
    ]);

    emitToUser(sender._id.toString(), "friendRequest:accepted", {
      request: populated,
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

    return sendSuccess(
      res,
      populated,
      SUCCESS_MESSAGES.FRIEND_REQUEST_ACCEPTED,
    );
  },
);

// ─── Decline friend request
export const declineFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);
    const { requestId } = req.params;

    const request =
      await FriendRequestModel.findById<IFriendRequest>(requestId);
    if (!request) throw ApiError.notFound("Friend request not found.");

    if (request.receiver.toString() !== userId) {
      throw ApiError.forbidden("You can only decline requests sent to you.");
    }

    request.status = "declined";
    await request.save();

    const populated = await FriendRequestModel.findById(requestId)
      .populate("sender", "username avatar status")
      .populate("receiver", "username avatar status")
      .lean<IFriendRequest>();

    await Promise.all([
      invalidateCache(request.sender.toString()),
      invalidateCache(userId),
    ]);

    emitToUser(request.sender.toString(), "friendRequest:declined", {
      request: populated,
      timestamp: new Date(),
    });

    return sendSuccess(
      res,
      populated,
      SUCCESS_MESSAGES.FRIEND_REQUEST_DECLINED,
    );
  },
);

// ─── Cancel friend request
export const cancelFriendRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);
    const requestId = validateObjectId(req.params.requestId as string);

    const request =
      await FriendRequestModel.findById<IFriendRequest>(requestId);
    if (!request) throw ApiError.notFound("Friend request not found.");

    if (request.sender.toString() !== userId) {
      throw ApiError.forbidden("You can only cancel requests you sent.");
    }

    const receiverId = request.receiver.toString();
    await request.deleteOne();

    await Promise.all([invalidateCache(userId), invalidateCache(receiverId)]);

    emitToUser(receiverId, "friendRequest:cancelled", {
      requestId,
      senderId: userId,
      timestamp: new Date(),
    });

    return sendSuccess(res, null, SUCCESS_MESSAGES.FRIEND_REQUEST_CANCELLED);
  },
);

// ─── Get pending (received) requests
export const getPendingRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);
    const cacheKey = getCacheKey.pending(userId);

    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));

    const pending = await FriendRequestModel.find({
      receiver: userId,
      status: "pending",
    })
      .populate("sender", "username avatar status bio")
      .sort({ createdAt: -1 })
      .lean<IFriendRequest[]>();

    await pubClient.setex(
      cacheKey,
      CACHE_TTL.REQUESTS,
      JSON.stringify(pending),
    );

    return sendSuccess(
      res,
      pending,
      "Pending friend requests fetched successfully.",
    );
  },
);

// ─── Get sent requests
export const getSentRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);
    const cacheKey = getCacheKey.sent(userId);

    const cached = await pubClient.get(cacheKey);
    if (cached) return sendSuccess(res, JSON.parse(cached));

    const sent = await FriendRequestModel.find({
      sender: userId,
      status: "pending",
    })
      .populate("receiver", "username avatar status bio")
      .sort({ createdAt: -1 })
      .lean<IFriendRequest[]>();

    await pubClient.setex(cacheKey, CACHE_TTL.REQUESTS, JSON.stringify(sent));

    return sendSuccess(res, sent, SUCCESS_MESSAGES.GET_FRIENDS_SUCCESS);
  },
);

// ─── Get all requests (sent + received)
export const getAllFriendRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = validateObjectId(req.user!._id);

    const [received, sent] = await Promise.all([
      FriendRequestModel.find({ receiver: userId, status: "pending" })
        .populate("sender", "username avatar status bio")
        .sort({ createdAt: -1 })
        .lean<IFriendRequest[]>(),
      FriendRequestModel.find({ sender: userId, status: "pending" })
        .populate("receiver", "username avatar status bio")
        .sort({ createdAt: -1 })
        .lean<IFriendRequest[]>(),
    ]);

    return sendSuccess(
      res,
      {
        received,
        sent,
        totalReceived: received.length,
        totalSent: sent.length,
      },
      SUCCESS_MESSAGES.GET_FRIENDS_SUCCESS,
    );
  },
);

export default {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  getPendingRequests,
  getSentRequests,
  getAllFriendRequests,
};
