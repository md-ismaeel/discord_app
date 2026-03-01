import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { ApiError } from "@/utils/ApiError";
import { sendSuccess } from "@/utils/response";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";
import type { IUser } from "@/types/models";
import { UserModel } from "@/models/user.model";
import { ServerMemberModel } from "@/models/serverMember.model";
import { ServerModel } from "@/models/server.model";
import { pubClient } from "@/config/redis.config";
import { hashPassword, comparePassword } from "@/utils/bcrypt";
import { emitToUser } from "@/socket/socketHandler";
import { validateObjectId } from "@/utils/validateObjId";
import { uploadAvatarToCloud } from "@/services/cloudinary.service";

// ─── Cache helpers
const CACHE_TTL = {
  USER: 1800,       // 30 minutes
  USERS_LIST: 600,  // 10 minutes
  FRIENDS: 900,     // 15 minutes
  BLOCKED: 900,     // 15 minutes
} as const;

const getCacheKey = {
  user: (userId: string) => `user:${userId}`,
  userServers: (userId: string) => `user:${userId}:servers`,
  userFriends: (userId: string) => `user:${userId}:friends`,
  userBlocked: (userId: string) => `user:${userId}:blocked`,
  searchResults: (query: string, page: number, limit: number) =>
    `search:users:${query}:${page}:${limit}`,
};

const invalidateUserCache = async (userId: string): Promise<void> => {
  const keys = [
    getCacheKey.user(userId),
    getCacheKey.userServers(userId),
    getCacheKey.userFriends(userId),
    getCacheKey.userBlocked(userId),
  ];
  await pubClient.del(...keys);

  const searchKeys = await pubClient.keys("search:users:*");
  if (searchKeys.length > 0) await pubClient.del(...searchKeys);
};

// ─── Get current user profile
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.user(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const user = await UserModel.findById<IUser>(userId)
    .select("-password")
    .populate("friends", "username avatar status customStatus lastSeen")
    .lean();

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(user));

  return sendSuccess(res, user, SUCCESS_MESSAGES.GET_PROFILE_SUCCESS);
});

// ─── Update current user profile
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const { name, username, bio, avatar } = req.body as {
    name?: string;
    username?: string;
    bio?: string;
    avatar?: string;
  };

  const user = await UserModel.findById<IUser>(userId);
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (username && username !== user.username) {
    const existingUser = await UserModel.findOne({ username });
    if (existingUser) throw ApiError.conflict(ERROR_MESSAGES.USERNAME_TAKEN);
    user.username = username;
  }

  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();
  await invalidateUserCache(userId);

  emitToUser(userId, "user:profileUpdated", {
    userId,
    updates: { name, username, bio, avatar },
    timestamp: new Date(),
  });

  const updatedUser = await UserModel.findById(userId).select("-password");

  return sendSuccess(res, updatedUser, "Profile updated successfully.");
});

// ─── Upload user avatar
// HOW THIS WORKS:
// 1. Multer middleware (uploadAvatar.single('avatar')) runs first in the route
// 2. Multer stores the file in memory as req.file.buffer
// 3. We pass the buffer to Cloudinary (uploadAvatarToCloud)
// 4. Cloudinary uploads and returns { url, publicId }
// 5. We save the URL + publicId to the database
export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);

  if (!req.file) throw ApiError.badRequest("No file uploaded.");

  // uploadAvatarToCloud is the correct export from cloudinary.service
  const uploadResult = await uploadAvatarToCloud(req.file.buffer, userId);

  const user = await UserModel.findByIdAndUpdate<IUser>(
    userId,
    {
      avatar: uploadResult.url,
      // IUser.avatarPublicId: string | undefined — store for future deletion
      avatarPublicId: uploadResult.publicId,
    },
    { new: true },
  ).select("-password");

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  await invalidateUserCache(userId);

  emitToUser(userId, "user:avatarUpdated", {
    userId,
    avatar: uploadResult.url,
    timestamp: new Date(),
  });

  return sendSuccess(res, { avatar: uploadResult.url }, "Avatar uploaded successfully.");
});

// ─── Change user password
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  // IUser.password is select:false — must use +password
  const user = await UserModel.findById<IUser>(userId).select("+password");
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  // IUser.provider: "email" | "google" | "github" | "facebook"
  if (user.provider !== "email") {
    throw ApiError.badRequest("Cannot change password for OAuth accounts.");
  }

  // IUser.password?: string — optional for OAuth users
  if (!user.password) {
    throw ApiError.badRequest("No password set for this account.");
  }

  const isPasswordValid = await comparePassword(currentPassword, user.password);
  if (!isPasswordValid) throw ApiError.unauthorized("Current password is incorrect.");

  user.password = await hashPassword(newPassword);
  await user.save();

  return sendSuccess(res, null, "Password changed successfully.");
});

// ─── Delete current user account
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);

  await ServerMemberModel.deleteMany({ user: userId });

  const ownedServers = await ServerModel.find({ owner: userId });

  await Promise.all(
    ownedServers.map(async (server) => {
      const nextAdmin = await ServerMemberModel.findOne({
        server: server._id,
        role: { $in: ["admin", "moderator"] },
        user: { $ne: userId },
      });

      if (nextAdmin) {
        server.owner = nextAdmin.user as Types.ObjectId;
        await server.save();
      } else {
        await server.deleteOne();
      }
    }),
  );

  await UserModel.findByIdAndDelete(userId);
  await invalidateUserCache(userId);

  return sendSuccess(res, null, "Account deleted successfully.");
});

// ─── Update user status
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  // IUser.status: "online" | "offline" | "away" | "dnd"
  const { status, customStatus } = req.body as {
    status: IUser["status"];
    customStatus?: string;
  };

  const user = await UserModel.findByIdAndUpdate<IUser>(
    userId,
    { status, customStatus: customStatus ?? "", lastSeen: new Date() },
    { new: true },
  ).select("-password");

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  await invalidateUserCache(userId);

  // IUser.friends: Types.ObjectId[] — notify each friend
  if (user.friends && user.friends.length > 0) {
    user.friends.forEach((friendId) => {
      emitToUser(friendId.toString(), "friend:statusUpdated", {
        userId,
        status,
        customStatus,
        timestamp: new Date(),
      });
    });
  }

  return sendSuccess(res, { status, customStatus }, "Status updated successfully.");
});

// ─── Get all servers current user is a member of
export const getUserServers = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.userServers(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const memberships = await ServerMemberModel.find({ user: userId })
    .select("server role joinedAt")
    .lean<Array<{ server: Types.ObjectId; role: string; joinedAt: Date }>>();

  const serverIds = memberships.map((m) => m.server);

  const servers = await ServerModel.find({ _id: { $in: serverIds } })
    .populate("owner", "username avatar")
    .populate("channels")
    .sort({ createdAt: -1 })
    .lean();

  // Attach the user's role and joinedAt to each server entry
  const serversWithRole = servers.map((server) => {
    const membership = memberships.find(
      (m) => m.server.toString() === server._id.toString(),
    );
    return { ...server, userRole: membership?.role, joinedAt: membership?.joinedAt };
  });

  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(serversWithRole));

  return sendSuccess(res, serversWithRole, "Servers fetched successfully.");
});

// ─── Get user's friends list
export const getFriends = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.userFriends(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const user = await UserModel.findById<IUser>(userId)
    .select("friends")
    .populate("friends", "username avatar status customStatus lastSeen bio")
    .lean();

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  const friends = user.friends ?? [];
  await pubClient.setex(cacheKey, CACHE_TTL.FRIENDS, JSON.stringify(friends));

  return sendSuccess(res, friends, "Friends fetched successfully.");
});

// ─── Add a friend
export const addFriend = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const { userId } = req.params as { userId: string };

  if (currentUserId === userId) {
    throw ApiError.badRequest("Cannot add yourself as a friend.");
  }

  const [currentUser, targetUser] = await Promise.all([
    UserModel.findById<IUser>(currentUserId),
    UserModel.findById<IUser>(userId),
  ]);
  if (!currentUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
  if (!targetUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  // IUser.friends: Types.ObjectId[] — must compare as strings
  if (currentUser.friends.some((id) => id.toString() === userId)) {
    throw ApiError.badRequest("Already friends with this user.");
  }

  currentUser.friends.push(userId as unknown as Types.ObjectId);
  targetUser.friends.push(currentUserId as unknown as Types.ObjectId);

  await Promise.all([currentUser.save(), targetUser.save()]);
  await Promise.all([invalidateUserCache(currentUserId), invalidateUserCache(userId)]);

  emitToUser(userId, "friend:added", {
    userId: currentUserId,
    user: {
      _id: currentUser._id,
      username: currentUser.username,
      avatar: currentUser.avatar,
      status: currentUser.status,
    },
    timestamp: new Date(),
  });

  return sendSuccess(res, targetUser, "Friend added successfully.");
});

// ─── Remove a friend
export const removeFriend = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const { userId } = req.params as { userId: string };

  const [currentUser, targetUser] = await Promise.all([
    UserModel.findById<IUser>(currentUserId),
    UserModel.findById<IUser>(userId),
  ]);
  if (!currentUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
  if (!targetUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  // IUser.friends: Types.ObjectId[]
  currentUser.friends = currentUser.friends.filter((id) => id.toString() !== userId);
  targetUser.friends = targetUser.friends.filter((id) => id.toString() !== currentUserId);

  await Promise.all([currentUser.save(), targetUser.save()]);
  await Promise.all([invalidateUserCache(currentUserId), invalidateUserCache(userId)]);

  emitToUser(userId, "friend:removed", { userId: currentUserId, timestamp: new Date() });

  return sendSuccess(res, null, "Friend removed successfully.");
});

// ─── Get list of blocked users
export const getBlockedUsers = asyncHandler(async (req: Request, res: Response) => {
  const userId = validateObjectId(req.user!._id);
  const cacheKey = getCacheKey.userBlocked(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const user = await UserModel.findById<IUser>(userId)
    .select("blockedUsers")
    .populate("blockedUsers", "username avatar")
    .lean();

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  const blockedUsers = user.blockedUsers ?? [];
  await pubClient.setex(cacheKey, CACHE_TTL.BLOCKED, JSON.stringify(blockedUsers));

  return sendSuccess(res, blockedUsers, "Blocked users fetched successfully.");
});

// ─── Block a user
export const blockUser = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const { userId } = req.params as { userId: string };

  if (currentUserId === userId) throw ApiError.badRequest("Cannot block yourself.");

  const [currentUser, targetUser] = await Promise.all([
    UserModel.findById<IUser>(currentUserId),
    UserModel.findById<IUser>(userId),
  ]);
  if (!currentUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
  if (!targetUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (!currentUser.blockedUsers) currentUser.blockedUsers = [];

  // IUser.blockedUsers: Types.ObjectId[]
  if (currentUser.blockedUsers.some((id) => id.toString() === userId)) {
    throw ApiError.badRequest("User is already blocked.");
  }

  currentUser.blockedUsers.push(userId as unknown as Types.ObjectId);

  // Remove from friends on both sides automatically
  currentUser.friends = currentUser.friends.filter((id) => id.toString() !== userId);
  targetUser.friends = targetUser.friends.filter((id) => id.toString() !== currentUserId);

  await Promise.all([currentUser.save(), targetUser.save()]);
  await invalidateUserCache(currentUserId);

  return sendSuccess(res, null, "User blocked successfully.");
});

// ─── Unblock a user
export const unblockUser = asyncHandler(async (req: Request, res: Response) => {
  const currentUserId = validateObjectId(req.user!._id);
  const { userId } = req.params as { userId: string };

  const currentUser = await UserModel.findById<IUser>(currentUserId);
  if (!currentUser) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  // IUser.blockedUsers: Types.ObjectId[]
  if (!currentUser.blockedUsers?.some((id) => id.toString() === userId)) {
    throw ApiError.badRequest("User is not blocked.");
  }

  currentUser.blockedUsers = currentUser.blockedUsers.filter(
    (id) => id.toString() !== userId,
  );
  await currentUser.save();
  await invalidateUserCache(currentUserId);

  return sendSuccess(res, null, "User unblocked successfully.");
});

// ─── Search for users by username or name
export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = (req.query.q as string | undefined) ?? "";
  // Query params are always strings — parse explicitly
  const page = parseInt((req.query.page as string) ?? "1", 10);
  const limit = parseInt((req.query.limit as string) ?? "20", 10);

  const cacheKey = getCacheKey.searchResults(query, page, limit);
  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const skip = (page - 1) * limit;

  // Note: email excluded from search — searching emails is a privacy risk
  const filter = {
    $or: [
      { username: { $regex: query, $options: "i" } },
      { name: { $regex: query, $options: "i" } },
    ],
    _id: { $ne: req.user!._id }, // exclude self
  };

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .select("username name avatar status bio")
      .limit(limit)
      .skip(skip)
      .lean<IUser[]>(),
    UserModel.countDocuments(filter),
  ]);

  const result = {
    users,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };

  await pubClient.setex(cacheKey, CACHE_TTL.USERS_LIST, JSON.stringify(result));

  return sendSuccess(res, result, "Users fetched successfully.");
});

// ─── Get user by ID (public profile)
export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const userId = validateObjectId(id);
  const cacheKey = getCacheKey.user(userId);

  const cached = await pubClient.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const user = await UserModel.findById<IUser>(userId)
    .select("username name avatar status customStatus bio lastSeen")
    .lean();

  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(user));

  return sendSuccess(res, user, "User fetched successfully.");
});

export default {
  getMe,
  updateProfile,
  uploadAvatar,
  changePassword,
  deleteAccount,
  updateStatus,
  getUserServers,
  getFriends,
  addFriend,
  removeFriend,
  getBlockedUsers,
  blockUser,
  unblockUser,
  searchUsers,
  getUserById,
};