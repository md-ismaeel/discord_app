import type { Request, Response, CookieOptions } from "express";
import type { Types } from "mongoose";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ApiError } from "@/utils/ApiError";
import { generateToken, verifyToken } from "@/utils/jwt";
import { hashPassword, comparePassword } from "@/utils/bcrypt";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";
import { getEnv } from "@/config/env.config";
import { UserModel } from "@/models/user.model";
import { setTokenCookie, clearTokenCookie } from "@/utils/setTokenCookie";
import { blacklistToken, isTokenBlacklisted } from "@/utils/redis";
import { HTTP_STATUS } from "@/constants/httpStatus";
import { validateObjectId } from "@/utils/validateObjId";
import {
  recordLoginAttempt,
  clearLoginAttempts,
  recordRegisterAttempt,
  clearRegisterAttempts,
} from "@/middlewares/rateLimit.middleware";

// ─── Register ─────────────────────────────────────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, username } = req.body as {
    name: string;
    email: string;
    password: string;
    username?: string;
  };
  // FIX: req.clientIp may not exist on base Request — fall back to req.ip ?? ""
  const clientIp: string = (req as Request & { clientIp?: string }).clientIp ?? req.ip ?? "";

  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    await recordRegisterAttempt(clientIp);
    throw ApiError.conflict(ERROR_MESSAGES.USER_ALREADY_EXISTS);
  }

  if (username) {
    const usernameTaken = await UserModel.findOne({ username });
    if (usernameTaken) {
      await recordRegisterAttempt(clientIp);
      throw ApiError.conflict(ERROR_MESSAGES.USERNAME_TAKEN);
    }
  }

  const hashedPassword = await hashPassword(password);

  const user = await UserModel.create({
    name,
    email,
    password: hashedPassword,
    username,
    provider: "email",
    status: "online",
    isEmailVerified: false,
  });

  // FIX: findById can return null — assert non-null after confirming creation succeeded
  const userResponse = await UserModel.findById(user._id).select("-password");
  if (!userResponse) throw ApiError.internal("Failed to retrieve created user.");

  const token = generateToken(userResponse._id);
  setTokenCookie(res, token);

  await clearRegisterAttempts(clientIp);

  return sendCreated(
    res,
    { user: userResponse, token },
    SUCCESS_MESSAGES.REGISTER_SUCCESS,
  );
});

// ─── Login ────────────────────────────────────────────────────────────────────

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, username, password } = req.body as {
    email?: string;
    username?: string;
    password: string;
  };
  const clientIp: string = (req as Request & { clientIp?: string }).clientIp ?? req.ip ?? "";

  const query = email ? { email } : { username };
  const user = await UserModel.findOne(query).select("+password");

  if (!user) {
    await recordLoginAttempt(clientIp);
    throw ApiError.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  if (user.provider !== "email") {
    await recordLoginAttempt(clientIp);
    throw ApiError.badRequest(
      `This account uses ${user.provider} login. Please sign in with ${user.provider}.`,
    );
  }

  // FIX: user.password may be undefined (not selected by default) — guard it
  if (!user.password) {
    await recordLoginAttempt(clientIp);
    throw ApiError.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    await recordLoginAttempt(clientIp);
    throw ApiError.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  await UserModel.findByIdAndUpdate(user._id, {
    status: "online",
    lastSeen: new Date(),
  });

  const token = generateToken(user._id);
  setTokenCookie(res, token);

  const userResponse = await UserModel.findById(user._id).select("-password");
  if (!userResponse) throw ApiError.internal("Failed to retrieve user.");

  await clearLoginAttempts(clientIp);

  return sendSuccess(
    res,
    { user: userResponse, token },
    SUCCESS_MESSAGES.LOGIN_SUCCESS,
  );
});

// ─── OAuth callback ───────────────────────────────────────────────────────────

export const oauthCallback = asyncHandler(async (req: Request, res: Response) => {
  // req.user is populated by Passport after OAuth flow
  const passportUser = req.user as { _id: Types.ObjectId } | undefined;
  if (!passportUser) {
    throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  const userId = validateObjectId(passportUser._id);

  await UserModel.findByIdAndUpdate(userId, {
    status: "online",
    lastSeen: new Date(),
  });

  const token = generateToken(userId);
  setTokenCookie(res, token);

  const clientUrl = getEnv("CLIENT_URL");
  // Token in query param — acceptable for OAuth redirect, but note it appears in logs.
  res.redirect(`${clientUrl}/auth/success?token=${token}`);
});

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token: string | undefined =
    req.cookies?.token ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

  if (token) {
    await blacklistToken(token, 604_800); // 7 days
  }

  // FIX: req.user typed as unknown on base Request — cast via intersection
  const userId = validateObjectId(
    (req as Request & { user?: { _id: Types.ObjectId } }).user?._id,
  );

  await UserModel.findByIdAndUpdate(userId, {
    status: "offline",
    lastSeen: new Date(),
  });

  // FIX: sameSite must be typed as CookieOptions["sameSite"], not a plain string
  const isProduction = getEnv("NODE_ENV") === "production";
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
  };
  res.clearCookie("token", cookieOptions);

  return sendSuccess(res, null, SUCCESS_MESSAGES.LOGOUT_SUCCESS);
});

// ─── Auth status ──────────────────────────────────────────────────────────────

export const getAuthStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = (req as Request & { user?: unknown }).user;

  if (user) {
    return sendSuccess(
      res,
      { isAuthenticated: true, user },
      SUCCESS_MESSAGES.AUTH_STATUS_SUCCESS,
    );
  }

  return sendSuccess(res, { isAuthenticated: false, user: null });
});

// ─── Refresh token ────────────────────────────────────────────────────────────
// FIX: original did `if (!decoded)` but our updated verifyToken THROWS on
// failure (never returns null). The null-check is now dead code — removed.
// The throw from verifyToken propagates through asyncHandler automatically.

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token: string | undefined =
    req.cookies?.refreshToken ?? req.body?.refreshToken;

  if (!token) {
    throw ApiError.unauthorized("Refresh token is required.");
  }

  // verifyToken throws ApiError.unauthorized on invalid/expired tokens
  const decoded = verifyToken(token);

  const isBlacklisted = await isTokenBlacklisted(token);
  if (isBlacklisted) {
    throw ApiError.unauthorized("Refresh token has been invalidated.");
  }

  const user = await UserModel.findById(decoded.userId);
  if (!user) {
    throw ApiError.unauthorized(ERROR_MESSAGES.USER_NOT_FOUND);
  }

  const newToken = generateToken(user._id);
  setTokenCookie(res, newToken);

  return sendSuccess(res, { token: newToken }, "Token refreshed successfully.");
});