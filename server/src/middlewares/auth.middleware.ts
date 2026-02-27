import type { Request, Response, NextFunction, RequestHandler } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyToken } from "../utils/jwt.js";
import { ERROR_MESSAGES } from "../constants/errorMessages.js";
import { UserModel } from "../models/user.model.js";
import { isTokenBlacklisted } from "../utils/redis.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract raw JWT from Authorization header or cookie. */
const extractToken = (req: Request): string | undefined => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return (req.cookies as Record<string, string | undefined>)?.["token"];
};

// ─── authenticated ────────────────────────────────────────────────────────────
// Requires a valid, non-blacklisted JWT. Attaches req.user and req.token.
// All errors are thrown as ApiError — asyncHandler forwards them to errorHandler.

export const authenticated = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);

    if (!token) {
      throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    }

    // verifyToken now throws typed ApiErrors for expired / invalid tokens —
    // no need to catch jwt-specific errors here.
    const decoded = verifyToken(token);

    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new ApiError(
        HTTP_STATUS.UNAUTHORIZED,
        "Token has been invalidated. Please log in again.",
      );
    }

    const user = await UserModel.findById(decoded.userId).select("-password");
    if (!user) {
      throw ApiError.unauthorized(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    req.user = user;
    req.token = token;
    next();
  },
);

// ─── optionalAuth ─────────────────────────────────────────────────────────────
// Silently attaches req.user if a valid token is present; continues without
// error if the token is absent, expired, or blacklisted.

export const optionalAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);

    if (!token) {
      next();
      return;
    }

    try {
      const isBlacklisted = await isTokenBlacklisted(token);
      if (isBlacklisted) {
        next();
        return;
      }

      const decoded = verifyToken(token);
      const user = await UserModel.findById(decoded.userId).select("-password");

      if (user) {
        req.user = user;
        req.token = token;
      }
    } catch {
      // Silently swallow — optional auth never blocks the request
    }

    next();
  },
);

// ─── authorize ────────────────────────────────────────────────────────────────
// Role-based guard. Pass the allowed roles as arguments.
// NOTE: Requires a `role` field on IUser — add it to the interface when ready.

export const authorize = (..._roles: string[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    }

    // Uncomment once IUser has a `role` field:
    // if (!_roles.includes(req.user.role)) {
    //   throw ApiError.forbidden(`Role '${req.user.role}' is not authorised.`);
    // }

    next();
  };
};

// ─── checkOwnership ───────────────────────────────────────────────────────────
// Ensures the authenticated user is the owner of the requested resource.
// Looks up the resource user ID from req.params[userIdParam] or req.body[userIdParam].

export const checkOwnership = (userIdParam = "userId"): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    }

    const resourceUserId: unknown =
      (req.params[userIdParam] as string | undefined) ??
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (req.body as Record<string, unknown>)[userIdParam];

    if (!resourceUserId) {
      throw ApiError.badRequest(`${userIdParam} is required.`);
    }

    if (req.user._id.toString() !== String(resourceUserId)) {
      throw ApiError.forbidden(ERROR_MESSAGES.FORBIDDEN);
    }

    next();
  };
};

// ─── requireEmailVerification ─────────────────────────────────────────────────
// Blocks access until the user has verified their email address.

export const requireEmailVerification: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    throw ApiError.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  if (!req.user.isEmailVerified) {
    throw ApiError.forbidden(
      "Please verify your email before accessing this resource.",
    );
  }

  next();
};

export default {
  authenticated,
  optionalAuth,
  authorize,
  checkOwnership,
  requireEmailVerification,
};