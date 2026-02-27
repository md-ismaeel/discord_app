import { asyncHandler } from "../utils/asyncHandler.ts";
import { sendSuccess, sendCreated } from "../utils/response.ts";
import { createApiError } from "../utils/ApiError.js";
import { generateToken, verifyToken } from "../utils/jwt.ts";
import { hashPassword, comparePassword } from "../utils/bcrypt.ts";
import { ERROR_MESSAGES } from "../constants/errorMessages.ts";
import { SUCCESS_MESSAGES } from "../constants/successMessages.ts";
import { getEnv } from "../config/env.config.ts";
import { UserModel } from "../models/user.model.ts";
import { setTokenCookie } from "../utils/setTokenCookie.ts";
import { blacklistToken, isTokenBlacklisted } from "../utils/redis.ts";
import { HTTP_STATUS } from "../constants/httpStatus.ts";
import { validateObjectId } from "../utils/validateObjId.ts";
import {
  recordLoginAttempt,
  clearLoginAttempts,
  recordRegisterAttempt,
  clearRegisterAttempts,
} from "../middlewares/rateLimit.middleware.js";

//    Register new user with email/password
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, username } = req.body;
  const clientIp = req.clientIp || req.ip;

  // Check if user already exists
  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    await recordRegisterAttempt(clientIp);
    throw createApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_MESSAGES.USER_ALREADY_EXISTS,
    );
  }

  // Check if username is taken (if provided)
  if (username) {
    const usernameTaken = await UserModel.findOne({ username });
    if (usernameTaken) {
      await recordRegisterAttempt(clientIp);
      throw createApiError(HTTP_STATUS.CONFLICT, ERROR_MESSAGES.USERNAME_TAKEN);
    }
  }

  // Hash password in controller
  const hashedPassword = await hashPassword(password);

  // Create user
  const user = await UserModel.create({
    name,
    email,
    password: hashedPassword,
    username,
    provider: "email",
    status: "online",
    isEmailVerified: false,
  });

  // Get user without password
  const userResponse = await UserModel.findById(user._id).select("-password");

  // Generate token
  const token = generateToken(userResponse._id);
  setTokenCookie(res, token);

  // Clear registration attempts on success
  await clearRegisterAttempts(clientIp);

  return sendCreated(
    res,
    { user: userResponse, token },
    SUCCESS_MESSAGES.REGISTER_SUCCESS,
  );
});

//    Login user with email/password
export const login = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;
  const clientIp = req.clientIp || req.ip;

  // Build query - user can login with either email or username
  const query = email ? { email } : { username };

  // Find user and explicitly select password
  const user = await UserModel.findOne(query).select("+password");

  if (!user) {
    await recordLoginAttempt(clientIp);
    throw createApiError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_MESSAGES.INVALID_CREDENTIALS,
    );
  }

  // Check if user registered with email (not OAuth)
  if (user.provider !== "email") {
    await recordLoginAttempt(clientIp);
    throw createApiError(
      HTTP_STATUS.BAD_REQUEST,
      `This account is registered with ${user.provider}. Please login using ${user.provider}.`,
    );
  }

  // Verify password using utility function
  const isPasswordValid = await comparePassword(password, user.password);

  if (!isPasswordValid) {
    await recordLoginAttempt(clientIp);
    throw createApiError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_MESSAGES.INVALID_CREDENTIALS,
    );
  }

  // Update status to online and last seen
  await UserModel.findByIdAndUpdate(user._id, {
    status: "online",
    lastSeen: new Date(),
  });

  // Generate token
  const token = generateToken(user._id);
  setTokenCookie(res, token);

  // Return user without password
  const userResponse = await UserModel.findById(user._id).select("-password");

  // Clear login attempts on success
  await clearLoginAttempts(clientIp);

  return sendSuccess(
    res,
    { user: userResponse, token },
    SUCCESS_MESSAGES.LOGIN_SUCCESS,
  );
});

//    OAuth callback handler (Google/GitHub/Facebook)
export const oauthCallback = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw createApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
  }

  const userId = validateObjectId(req.user._id);

  // Update status to online and last seen
  await UserModel.findByIdAndUpdate(userId, {
    status: "online",
    lastSeen: new Date(),
  });

  // Generate token
  const token = generateToken(userId);
  setTokenCookie(res, token);

  // Redirect to frontend
  const clientUrl = getEnv("CLIENT_URL");
  res.redirect(`${clientUrl}/auth/success?token=${token}`);
});

//    Logout user
export const logout = asyncHandler(async (req, res) => {
  // Get token from cookie or header
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

  // Blacklist token (7 days = 604800 seconds)
  if (token) {
    await blacklistToken(token, 604800);
  }

  const userId = validateObjectId(req.user._id);

  // Update user status to offline
  await UserModel.findByIdAndUpdate(userId, {
    status: "offline",
    lastSeen: new Date(),
  });

  // Clear cookie
  res.clearCookie("token", {
    httpOnly: true,
    secure: getEnv("NODE_ENV") === "production",
    sameSite: getEnv("NODE_ENV") === "production" ? "strict" : "lax",
  });

  return sendSuccess(res, null, SUCCESS_MESSAGES.LOGOUT_SUCCESS);
});

//    Get authentication status
export const getAuthStatus = asyncHandler(async (req, res) => {
  if (req.user) {
    return sendSuccess(
      res,
      { isAuthenticated: true, user: req.user },
      SUCCESS_MESSAGES.AUTH_STATUS_SUCCESS,
    );
  }

  return sendSuccess(res, {
    isAuthenticated: false,
    user: null,
  });
});

//    Refresh access token
export const refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    throw createApiError(HTTP_STATUS.UNAUTHORIZED, "Refresh token required");
  }

  // Verify refresh token
  const decoded = verifyToken(refreshToken);

  if (!decoded) {
    throw createApiError(HTTP_STATUS.UNAUTHORIZED, "Invalid refresh token");
  }

  // Check if token is blacklisted
  const isBlacklisted = await isTokenBlacklisted(refreshToken);
  if (isBlacklisted) {
    throw createApiError(
      HTTP_STATUS.UNAUTHORIZED,
      "Refresh token has been invalidated",
    );
  }

  // Get user - use decoded.userId (matching what we put in generateToken)
  const user = await UserModel.findById(decoded.userId);

  if (!user) {
    throw createApiError(
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  // Generate new access token
  const newToken = generateToken(user._id);
  setTokenCookie(res, newToken);

  return sendSuccess(res, { token: newToken }, "Token refreshed successfully");
});
