import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { createApiError } from "../utils/ApiError";
import { verifyToken } from "../utils/jwt";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { UserModel } from "../models/user.model";
import { isTokenBlacklisted } from "../utils/redis";
import { HTTP_STATUS } from "../constants/httpStatus";

export const authenticated = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token: string | undefined;

    // Check for token in Authorization header (Bearer token)
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    // No token found
    if (!token) {
      throw createApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
    }

    try {
      // Check if token is blacklisted (logged out)
      const isBlacklisted = await isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw createApiError(
          HTTP_STATUS.UNAUTHORIZED,
          "Token has been invalidated. Please login again."
        );
      }

      // Verify token and decode
      const decoded = verifyToken(token);

      if (!decoded || !decoded.userId) {
        throw createApiError(
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_MESSAGES.TOKEN_EXPIRED
        );
      }

      const user = await UserModel.findById(decoded.userId).select("-password");

      if (!user) {
        throw createApiError(
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_MESSAGES.USER_NOT_FOUND
        );
      }

      // Attach user to request object
      req.user = user;
      req.token = token;

      next();
    } catch (error: any) {
      // Handle JWT specific errors
      if (error.name === "JsonWebTokenError") {
        throw createApiError(
          HTTP_STATUS.UNAUTHORIZED,
          "Invalid token. Please login again."
        );
      } else if (error.name === "TokenExpiredError") {
        throw createApiError(
          HTTP_STATUS.UNAUTHORIZED,
          "Token expired. Please login again."
        );
      }

      // Re-throw other errors
      throw error;
    }
  }
);

export const optionalAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token: string | undefined;

    // Check for token in Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }
    // Check for token in cookies
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    // No token - continue without user
    if (!token) {
      return next();
    }

    try {
      // Check if token is blacklisted
      const isBlacklisted = await isTokenBlacklisted(token);
      if (isBlacklisted) {
        return next();
      }

      // Verify and decode token
      const decoded = verifyToken(token);

      if (decoded && decoded.userId) {
        // Get user from database
        const user = await UserModel.findById(decoded.userId).select("-password");

        if (user) {
          req.user = user;
          req.token = token;
        }
      }
    } catch (error: any) {
      // Silently fail - this is optional auth
      console.warn("Optional auth failed:", error.message);
    }

    next();
  }
);

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw createApiError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_MESSAGES.UNAUTHORIZED
      );
    }

    // Note: You'll need to add a 'role' field to IUser interface
    // if (!roles.includes(req.user.role)) {
    //   throw createApiError(
    //     HTTP_STATUS.FORBIDDEN,
    //     `User role '${req.user.role}' is not authorized`
    //   );
    // }

    next();
  };
};

export const checkOwnership = (userIdParam: string = "userId") => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw createApiError(
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_MESSAGES.UNAUTHORIZED
      );
    }

    const resourceUserId = req.params[userIdParam] || req.body[userIdParam];

    if (!resourceUserId) {
      throw createApiError(
        HTTP_STATUS.BAD_REQUEST,
        `${userIdParam} is required`
      );
    }

    if (req.user._id.toString() !== resourceUserId.toString()) {
      throw createApiError(
        HTTP_STATUS.FORBIDDEN,
        "You don't have permission to access this resource"
      );
    }

    next();
  };
};

export const requireEmailVerification = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    throw createApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.UNAUTHORIZED);
  }

  if (!req.user.isEmailVerified) {
    throw createApiError(
      HTTP_STATUS.FORBIDDEN,
      "Please verify your email before accessing this resource"
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