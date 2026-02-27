import { asyncHandler } from "../utils/asyncHandler.js";
import { createApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../utils/response.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { SUCCESS_MESSAGES } from "../constants/successMessages.js";
import { UserModel } from "../models/user.model.js";
import { ServerMemberModel } from "../models/serverMember.model.js";
import { ServerModel } from "../models/server.model.js";
import { pubClient } from "../config/redis.config.js";
import { hashPassword, comparePassword } from "../utils/bcrypt.js";
import { emitToUser } from "../socket/socketHandler.js";
import { validateObjectId } from "../utils/validateObjId.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";
import { uploadAvatarToCloud } from "../services/cloudinary.service.js";

// REDIS CACHE HELPERS
const CACHE_TTL = {
  USER: 1800, // 30 minutes
  USERS_LIST: 600, // 10 minutes
  FRIENDS: 900, // 15 minutes
  BLOCKED: 900, // 15 minutes
};

const getCacheKey = {
  user: (userId) => `user:${userId}`,
  userServers: (userId) => `user:${userId}:servers`,
  userFriends: (userId) => `user:${userId}:friends`,
  userBlocked: (userId) => `user:${userId}:blocked`,
  searchResults: (query, page, limit) => `search:users:${query}:${page}:${limit}`,
};

const invalidateUserCache = async (userId) => {
  const keys = [
    getCacheKey.user(userId),
    getCacheKey.userServers(userId),
    getCacheKey.userFriends(userId),
    getCacheKey.userBlocked(userId),
  ];

  await pubClient.del(...keys);

  // Also invalidate search cache
  const searchKeys = await pubClient.keys("search:users:*");
  if (searchKeys.length > 0) {
    await pubClient.del(...searchKeys);
  }
};

// PROFILE CONTROLLERS
// Get current user profile
export const getMe = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.user(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const user = await UserModel.findById(userId)
    .select("-password")
    .populate("friends", "username avatar status customStatus lastSeen")
    .lean();

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(user));

  sendSuccess(res, user, SUCCESS_MESSAGES.GET_PROFILE_SUCCESS);
});

// Update current user profile
export const updateProfile = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { name, username, bio, avatar } = req.body;

  const user = await UserModel.findById(userId);

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Check if username is already taken (if being changed)
  if (username && username !== user.username) {
    const existingUser = await UserModel.findOne({ username });
    if (existingUser) {
      throw createApiError(HTTP_STATUS.CONFLICT, ERROR_MESSAGES.USERNAME_TAKEN);
    }
    user.username = username;
  }

  // Update fields
  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();

  // Invalidate cache
  await invalidateUserCache(userId);

  // Emit socket event to user
  emitToUser(userId, "user:profileUpdated", {
    userId,
    updates: { name, username, bio, avatar },
    timestamp: new Date(),
  });

  const updatedUser = await UserModel.findById(userId).select("-password");

  sendSuccess(res, updatedUser, "Profile updated successfully");
});

/**
 * Upload user avatar
 * 
 * HOW THIS WORKS:
 * 1. Multer middleware (uploadAvatar.single('avatar')) runs first in the route
 * 2. Multer stores the file in memory as req.file.buffer
 * 3. This controller receives req.file with the buffer
 * 4. We pass the buffer to Cloudinary service
 * 5. Cloudinary uploads and returns a URL
 * 6. We save the URL to the database
 */
export const uploadAvatar = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);

  // req.file comes from multer middleware
  if (!req.file) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "No file uploaded");
  }

  // Upload to Cloudinary (pass the buffer from multer)
  const uploadResult = await uploadAvatarToCloud(req.file.buffer, userId);

  // Update user's avatar URL in database
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { avatar: uploadResult.url },
    { new: true },
  ).select("-password");

  // Invalidate cache
  await invalidateUserCache(userId);

  // Emit socket event
  emitToUser(userId, "user:avatarUpdated", {
    userId,
    avatar: uploadResult.url,
    timestamp: new Date(),
  });

  sendSuccess(res, { avatar: uploadResult.url }, "Avatar uploaded successfully");
});

// Change user password
export const changePassword = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { currentPassword, newPassword } = req.body;

  const user = await UserModel.findById(userId).select("+password");

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Verify user registered with email (not OAuth)
  if (user.provider !== "email") {
    throw createApiError(
      HTTP_STATUS.BAD_REQUEST,
      "Cannot change password for OAuth accounts",
    );
  }

  // Verify current password
  const isPasswordValid = await comparePassword(currentPassword, user.password);

  if (!isPasswordValid) {
    throw createApiError(HTTP_STATUS.UNAUTHORIZED, "Current password is incorrect");
  }

  // Hash and save new password
  user.password = await hashPassword(newPassword);
  await user.save();

  sendSuccess(res, null, "Password changed successfully");
});

// Delete current user account
export const deleteAccount = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);

  // Delete user's server memberships
  await ServerMemberModel.deleteMany({ user: userId });

  // Transfer ownership or delete servers owned by user
  const ownedServers = await ServerModel.find({ owner: userId });
  for (const server of ownedServers) {
    const nextAdmin = await ServerMemberModel.findOne({
      server: server._id,
      role: { $in: ["admin", "moderator"] },
      user: { $ne: userId },
    });

    if (nextAdmin) {
      server.owner = nextAdmin.user;
      await server.save();
    } else {
      await server.deleteOne();
    }
  }

  // Delete user
  await UserModel.findByIdAndDelete(userId);

  // Invalidate all user caches
  await invalidateUserCache(userId);

  sendSuccess(res, null, "Account deleted successfully");
});

// Update user status
export const updateStatus = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const { status, customStatus } = req.body;

  const user = await UserModel.findByIdAndUpdate(
    userId,
    {
      status,
      customStatus: customStatus || "",
      lastSeen: new Date(),
    },
    { new: true },
  ).select("-password");

  // Invalidate cache
  await invalidateUserCache(userId);

  // Emit to user's friends
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

  sendSuccess(res, { status, customStatus }, "Status updated successfully");
});
// SERVER MANAGEMENT
// Get all servers current user is a member of
export const getUserServers = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.userServers(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const memberships = await ServerMemberModel.find({ user: userId })
    .select("server role joinedAt")
    .lean();

  const serverIds = memberships.map((m) => m.server);

  const servers = await ServerModel.find({ _id: { $in: serverIds } })
    .populate("owner", "username avatar")
    .populate("channels")
    .sort({ createdAt: -1 })
    .lean();

  // Add user's role to each server
  const serversWithRole = servers.map((server) => {
    const membership = memberships.find(
      (m) => m.server.toString() === server._id.toString(),
    );
    return {
      ...server,
      userRole: membership?.role,
      joinedAt: membership?.joinedAt,
    };
  });

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(serversWithRole));

  sendSuccess(res, serversWithRole, "Servers fetched successfully");
});
// FRIENDS MANAGEMENT
// Get user's friends list
export const getFriends = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.userFriends(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const user = await UserModel.findById(userId)
    .populate("friends", "username avatar status customStatus lastSeen bio")
    .select("friends")
    .lean();

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.FRIENDS, JSON.stringify(user.friends));

  sendSuccess(res, user.friends, "Friends fetched successfully");
});

// Add a friend
export const addFriend = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  if (currentUserId === userId) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "Cannot add yourself as a friend");
  }

  const targetUser = await UserModel.findById(userId);
  if (!targetUser) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const currentUser = await UserModel.findById(currentUserId);

  // Check if already friends
  if (currentUser.friends.includes(userId)) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "Already friends with this user");
  }

  // Add to both users' friends lists
  currentUser.friends.push(userId);
  targetUser.friends.push(currentUserId);

  await Promise.all([currentUser.save(), targetUser.save()]);

  // Invalidate caches
  await Promise.all([invalidateUserCache(currentUserId), invalidateUserCache(userId)]);

  // Emit socket events
  emitToUser(userId, "friend:added", {
    userId: currentUserId,
    user: {
      _id: currentUserId,
      username: currentUser.username,
      avatar: currentUser.avatar,
      status: currentUser.status,
    },
    timestamp: new Date(),
  });

  sendSuccess(res, targetUser, "Friend added successfully");
});

// Remove a friend
export const removeFriend = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  const currentUser = await UserModel.findById(currentUserId);
  const targetUser = await UserModel.findById(userId);

  if (!targetUser) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Remove from both users' friends lists
  currentUser.friends = currentUser.friends.filter((id) => id.toString() !== userId);
  targetUser.friends = targetUser.friends.filter(
    (id) => id.toString() !== currentUserId,
  );

  await Promise.all([currentUser.save(), targetUser.save()]);

  // Invalidate caches
  await Promise.all([invalidateUserCache(currentUserId), invalidateUserCache(userId)]);

  // Emit socket events
  emitToUser(userId, "friend:removed", {
    userId: currentUserId,
    timestamp: new Date(),
  });

  sendSuccess(res, null, "Friend removed successfully");
});
// BLOCKING MANAGEMENT
// Get list of blocked users
export const getBlockedUsers = asyncHandler(async (req, res) => {
  const userId = validateObjectId(req.user._id);
  const cacheKey = getCacheKey.userBlocked(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const user = await UserModel.findById(userId)
    .populate("blockedUsers", "username avatar")
    .select("blockedUsers")
    .lean();

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const blockedUsers = user.blockedUsers || [];

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.BLOCKED, JSON.stringify(blockedUsers));

  sendSuccess(res, blockedUsers, "Blocked users fetched successfully");
});

// Block a user
export const blockUser = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  if (currentUserId === userId) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "Cannot block yourself");
  }

  const targetUser = await UserModel.findById(userId);
  if (!targetUser) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const currentUser = await UserModel.findById(currentUserId);

  // Add to blocked users
  if (!currentUser.blockedUsers) {
    currentUser.blockedUsers = [];
  }

  if (currentUser.blockedUsers.includes(userId)) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "User already blocked");
  }

  currentUser.blockedUsers.push(userId);

  // Remove from friends if they were friends
  currentUser.friends = currentUser.friends.filter((id) => id.toString() !== userId);
  targetUser.friends = targetUser.friends.filter(
    (id) => id.toString() !== currentUserId,
  );

  await Promise.all([currentUser.save(), targetUser.save()]);

  // Invalidate caches
  await invalidateUserCache(currentUserId);

  sendSuccess(res, null, "User blocked successfully");
});

// Unblock a user
export const unblockUser = asyncHandler(async (req, res) => {
  const currentUserId = validateObjectId(req.user._id);
  const { userId } = req.params;

  const currentUser = await UserModel.findById(currentUserId);

  if (!currentUser.blockedUsers || !currentUser.blockedUsers.includes(userId)) {
    throw createApiError(HTTP_STATUS.BAD_REQUEST, "User is not blocked");
  }

  currentUser.blockedUsers = currentUser.blockedUsers.filter(
    (id) => id.toString() !== userId,
  );

  await currentUser.save();

  // Invalidate cache
  await invalidateUserCache(currentUserId);

  sendSuccess(res, null, "User unblocked successfully");
});

// USER SEARCH & DISCOVERY
// Search for users by username or email
export const searchUsers = asyncHandler(async (req, res) => {
  const { q: query, page = 1, limit = 20 } = req.query;
  const cacheKey = getCacheKey.searchResults(query, page, limit);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const skip = (page - 1) * limit;

  const users = await UserModel.find({
    $or: [
      { username: { $regex: query, $options: "i" } },
      { name: { $regex: query, $options: "i" } },
      { email: { $regex: query, $options: "i" } },
    ],
    _id: { $ne: req.user._id }, // Exclude current user
  })
    .select("username name avatar status bio")
    .limit(parseInt(limit))
    .skip(skip)
    .lean();

  const total = await UserModel.countDocuments({
    $or: [
      { username: { $regex: query, $options: "i" } },
      { name: { $regex: query, $options: "i" } },
      { email: { $regex: query, $options: "i" } },
    ],
    _id: { $ne: req.user._id },
  });

  const result = {
    users,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  };

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.USERS_LIST, JSON.stringify(result));

  sendSuccess(res, result, "Users fetched successfully");
});

// Get user by ID
export const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const userId = validateObjectId(id);
  const cacheKey = getCacheKey.user(userId);

  // Try cache first
  const cached = await pubClient.get(cacheKey);
  if (cached) {
    return sendSuccess(res, JSON.parse(cached));
  }

  const user = await UserModel.findById(userId)
    .select("username name avatar status customStatus bio lastSeen")
    .lean();

  if (!user) {
    throw createApiError(HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
  }

  // Cache the result
  await pubClient.setex(cacheKey, CACHE_TTL.USER, JSON.stringify(user));

  sendSuccess(res, user, "User fetched successfully");
});