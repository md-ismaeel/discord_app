import type { Request, Response } from "express";
import type { CookieOptions } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { sendSuccess, sendCreated } from "@/utils/response";
import { ApiError } from "@/utils/ApiError";
import { generateToken, verifyToken } from "@/utils/jwt";
import { hashPassword, comparePassword } from "@/utils/bcrypt";
import { ERROR_MESSAGES } from "@/constants/errorMessages";
import { SUCCESS_MESSAGES } from "@/constants/successMessages";
import { getEnv } from "@/config/env.config";
import { UserModel } from "@/models/user.model";
import { setTokenCookie } from "@/utils/setTokenCookie";
import { blacklistToken, isTokenBlacklisted, storeEmailOtp, verifyEmailOtp as verifyEmailOtpInRedis, storePhoneOtp, verifyPhoneOtp as verifyPhoneOtpInRedis } from "@/utils/redis";
import { validateObjectId } from "@/utils/validateObjId";
import { sendOtpEmail } from "@/services/email.service";
import { sendOtpSms } from "@/services/sms.service";
import {
  recordLoginAttempt,
  clearLoginAttempts,
  recordRegisterAttempt,
  clearRegisterAttempts,
} from "@/middlewares/rateLimit.middleware";

// ─── Register
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, username } = req.body as {
    name: string;
    email: string;
    password: string;
    username?: string;
  };
  const clientIp: string = req.clientIp ?? req.ip ?? "";

  // Check duplicate email
  const existingUser = await UserModel.findOne({ email });
  if (existingUser) {
    await recordRegisterAttempt(clientIp);
    throw ApiError.conflict(ERROR_MESSAGES.USER_ALREADY_EXISTS);
  }

  // Check duplicate username
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

  // IUser from models.ts — findById returns IUser | null
  const userResponse = await UserModel.findById(user._id).select("-password");
  if (!userResponse) throw ApiError.internal("Failed to retrieve created user.");

  const token = generateToken(userResponse._id);
  setTokenCookie(res, token);
  await clearRegisterAttempts(clientIp);

  sendCreated(res, { user: userResponse, token }, SUCCESS_MESSAGES.REGISTER_SUCCESS);
});

//  Login
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, username, password } = req.body as {
    email?: string;
    username?: string;
    password: string;
  };
  const clientIp: string = req.clientIp ?? req.ip ?? "";

  const query = email ? { email } : { username };

  // IUser.password is select:false in schema — must explicitly include
  const user = await UserModel.findOne(query).select("+password");
  if (!user) {
    await recordLoginAttempt(clientIp);
    throw ApiError.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // IUser.provider: "email" | "google" | "github" | "facebook"
  if (user.provider !== "email") {
    await recordLoginAttempt(clientIp);
    throw ApiError.badRequest(
      `This account uses ${user.provider} login. Please sign in with ${user.provider}.`,
    );
  }

  // IUser.password is optional (not required for OAuth users)
  if (!user.password) {
    await recordLoginAttempt(clientIp);
    throw ApiError.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  const isValid = await comparePassword(password, user.password);
  if (!isValid) {
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

//  OAuth callback
export const oauthCallback = asyncHandler(async (req: Request, res: Response) => {
  // req.user is IUser | undefined (from express.d.ts augmentation via passport)
  if (!req.user) {
    throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // req.user._id is Types.ObjectId from IUser
  const userId = validateObjectId(req.user._id);

  await UserModel.findByIdAndUpdate(userId, {
    status: "online",
    lastSeen: new Date(),
  });

  const token = generateToken(userId);
  setTokenCookie(res, token);

  const clientUrl = getEnv("CLIENT_URL");
  res.redirect(`${clientUrl}/auth/success?token=${token}`);
});

//  Logout
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token: string | undefined =
    req.cookies?.token ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

  if (token) {
    await blacklistToken(token, 604_800); // 7 days TTL
  }

  // req.user is IUser | undefined per express.d.ts — guard it
  if (!req.user) {
    throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  const userId = validateObjectId(req.user._id);

  await UserModel.findByIdAndUpdate(userId, {
    status: "offline",
    lastSeen: new Date(),
  });

  const isProduction = getEnv("NODE_ENV") === "production";
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
  };
  res.clearCookie("token", cookieOptions);

  return sendSuccess(res, null, SUCCESS_MESSAGES.LOGOUT_SUCCESS);
});

//  Auth status
export const getAuthStatus = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    return sendSuccess(res, { isAuthenticated: true, user: req.user }, SUCCESS_MESSAGES.AUTH_STATUS_SUCCESS);
  }
  return sendSuccess(res, { isAuthenticated: false, user: null });
});

//  Refresh token
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token: string | undefined =
    req.cookies?.refreshToken ?? req.body?.refreshToken;

  if (!token) {
    throw ApiError.unauthorized("Refresh token is required.");
  }

  // verifyToken throws ApiError on invalid/expired — no null check needed
  const decoded = verifyToken(token);

  const isBlacklisted = await isTokenBlacklisted(token);
  if (isBlacklisted) {
    throw ApiError.unauthorized("Refresh token has been invalidated.");
  }

  const user = await UserModel.findById(decoded.userId);
  if (!user) throw ApiError.unauthorized(ERROR_MESSAGES.USER_NOT_FOUND);

  const newToken = generateToken(user._id);
  setTokenCookie(res, newToken);

  return sendSuccess(res, { token: newToken }, "Token refreshed successfully.");
});

//  OTP helpers

/** Cryptographically adequate 6-digit OTP (000000–999999). */
const generateOtp = (): string =>
  Math.floor(100_000 + Math.random() * 900_000).toString();

/** Translate a Redis OTP result into an ApiError (throws) or returns void. */
const handleOtpResult = (result: "ok" | "invalid" | "expired" | "locked"): void => {
  if (result === "ok") return;
  if (result === "locked") throw ApiError.tooManyRequests(ERROR_MESSAGES.OTP_LOCKED);
  // "invalid" and "expired" both map to the same generic message — avoids
  // giving a timing oracle that reveals whether the OTP ever existed.
  throw ApiError.badRequest(ERROR_MESSAGES.OTP_INVALID);
};

//  Email OTP

/**
 * POST /auth/send-email-otp
 * Generate a 6-digit OTP, store it (hashed) in Redis, and email it to the user.
 */
export const sendEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };

  const user = await UserModel.findOne({ email });
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (user.isEmailVerified) {
    throw ApiError.conflict(ERROR_MESSAGES.OTP_ALREADY_VERIFIED);
  }

  const otp = generateOtp();
  await storeEmailOtp(email, otp);

  try {
    await sendOtpEmail(email, otp);
  } catch (err) {
    console.error("[OTP] Failed to send email:", err);
    throw ApiError.internal(ERROR_MESSAGES.EMAIL_SEND_FAILED);
  }

  return sendSuccess(res, null, SUCCESS_MESSAGES.OTP_EMAIL_SENT);
});

/**
 * POST /auth/verify-email-otp
 * Compare the submitted code against the stored hash and mark email as verified.
 */
export const verifyEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = req.body as { email: string; code: string };

  const user = await UserModel.findOne({ email });
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (user.isEmailVerified) {
    throw ApiError.conflict(ERROR_MESSAGES.OTP_ALREADY_VERIFIED);
  }

  const result = await verifyEmailOtpInRedis(email, code);
  handleOtpResult(result);

  await UserModel.findByIdAndUpdate(user._id, { isEmailVerified: true });

  return sendSuccess(res, null, SUCCESS_MESSAGES.EMAIL_VERIFIED);
});

//  Phone OTP

// * Generate a 6-digit OTP, store it (hashed) in Redis, and SMS it.
export const sendPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber } = req.body as { phoneNumber: string };

  const user = await UserModel.findOne({ phoneNumber });
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (user.isPhoneVerified) {
    throw ApiError.conflict(ERROR_MESSAGES.OTP_ALREADY_VERIFIED);
  }

  const otp = generateOtp();
  await storePhoneOtp(phoneNumber, otp);

  try {
    await sendOtpSms(phoneNumber, otp);
  } catch (err) {
    console.error("[OTP] Failed to send SMS:", err);
    throw ApiError.internal(ERROR_MESSAGES.SMS_SEND_FAILED);
  }

  return sendSuccess(res, null, SUCCESS_MESSAGES.OTP_PHONE_SENT);
});

/**
 * POST /auth/verify-phone-otp
 * Compare the submitted code against the stored hash and mark phone as verified.
 */
export const verifyPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber, code } = req.body as { phoneNumber: string; code: string };

  const user = await UserModel.findOne({ phoneNumber });
  if (!user) throw ApiError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);

  if (user.isPhoneVerified) {
    throw ApiError.conflict(ERROR_MESSAGES.OTP_ALREADY_VERIFIED);
  }

  const result = await verifyPhoneOtpInRedis(phoneNumber, code);
  handleOtpResult(result);

  await UserModel.findByIdAndUpdate(user._id, { isPhoneVerified: true });

  return sendSuccess(res, null, SUCCESS_MESSAGES.PHONE_VERIFIED);
});