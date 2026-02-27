import type { Request, Response, NextFunction, RequestHandler } from "express";
import { pubClient } from "@/config/redis.config";
import { ApiError, isApiError } from "@/utils/ApiError";
import { asyncHandler } from "@/utils/asyncHandler";

// ─── Types

interface RateLimitError {
  field: "rateLimit";
  message: string;
  retryAfter: number;
}

// ─── IP resolution

/**
 * Resolve the real client IP, honouring X-Forwarded-For from trusted proxies.
 * Make sure Express's `trust proxy` setting is enabled when behind a load balancer.
 */
const getClientIp = (req: Request): string =>
  (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim() ??
  (req.headers["x-real-ip"] as string | undefined) ??
  req.ip ??
  req.socket.remoteAddress ?? // req.connection is deprecated since Node 13
  "unknown";

// ─── Factory

/**
 * Build a rate-limiter middleware backed by Redis.
 *
 * @param prefix        - Redis key prefix, e.g. "login_attempts"
 * @param maxAttempts   - Maximum allowed requests in the window
 * @param windowSeconds - Sliding window duration in seconds
 * @param errorMessage  - Message shown when the limit is exceeded
 */
const createRateLimiter = (
  prefix: string,
  maxAttempts: number,
  windowSeconds: number,
  errorMessage: string,
): RequestHandler =>
  asyncHandler(
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      const ip = getClientIp(req);
      const key = `${prefix}:${ip}`;

      try {
        const raw = await pubClient.get(key);
        const currentAttempts = raw !== null ? parseInt(raw, 10) : 0;

        if (currentAttempts >= maxAttempts) {
          const ttl = await pubClient.ttl(key);
          const minutesLeft = Math.ceil(ttl / 60);

          const details: RateLimitError = {
            field: "rateLimit",
            message: `Rate limit exceeded. Retry after ${minutesLeft} minute(s).`,
            retryAfter: ttl,
          };

          throw new ApiError(
            429,
            errorMessage ||
            `Too many attempts. Please try again in ${minutesLeft} minute(s).`,
            [details],
          );
        }

        req.clientIp = ip;
        next();
      } catch (err) {
        if (isApiError(err)) {
          throw err; // Re-throw rate-limit errors — they're expected
        }
        // Redis is unavailable — log and fail open (don't block the request)
        console.error(`Rate limiter unavailable for "${prefix}":`, err);
        next();
      }
    },
  );

// ─── Shared internals

/**
 * Increment (or create) the attempt counter for an IP.
 * Called after a failed attempt so the counter only climbs on failures.
 */
const recordAttempt = async (
  prefix: string,
  ip: string,
  windowSeconds: number,
): Promise<void> => {
  const key = `${prefix}:${ip}`;
  try {
    const exists = await pubClient.get(key);
    if (exists !== null) {
      await pubClient.incr(key);
    } else {
      await pubClient.setex(key, windowSeconds, "1");
    }
  } catch (err) {
    console.error(`recordAttempt failed for "${prefix}":`, err);
  }
};

/** Remove the attempt counter after a successful operation. */
const clearAttempts = async (prefix: string, ip: string): Promise<void> => {
  try {
    await pubClient.del(`${prefix}:${ip}`);
  } catch (err) {
    console.error(`clearAttempts failed for "${prefix}":`, err);
  }
};

// ─── Login
// 5 attempts / 15 minutes

export const loginRateLimit = createRateLimiter(
  "login_attempts",
  5,
  900,
  "Too many login attempts. Please try again in a few minutes.",
);

export const recordLoginAttempt = (ip: string): Promise<void> =>
  recordAttempt("login_attempts", ip, 900);

export const clearLoginAttempts = (ip: string): Promise<void> =>
  clearAttempts("login_attempts", ip);

// ─── Register 
// 3 attempts / 15 minutes

export const registerRateLimit = createRateLimiter(
  "register_attempts",
  3,
  900,
  "Too many registration attempts. Please try again in a few minutes.",
);

export const recordRegisterAttempt = (ip: string): Promise<void> =>
  recordAttempt("register_attempts", ip, 900);

export const clearRegisterAttempts = (ip: string): Promise<void> =>
  clearAttempts("register_attempts", ip);

// ─── Password reset 
// 3 attempts / 1 hour

export const passwordResetRateLimit = createRateLimiter(
  "password_reset_attempts",
  3,
  3600,
  "Too many password reset requests. Please try again later.",
);

export const recordPasswordResetAttempt = (ip: string): Promise<void> =>
  recordAttempt("password_reset_attempts", ip, 3600);

export const clearPasswordResetAttempts = (ip: string): Promise<void> =>
  clearAttempts("password_reset_attempts", ip);

// ─── Email verification 
// 5 attempts / 30 minutes

export const emailVerificationRateLimit = createRateLimiter(
  "email_verification_attempts",
  5,
  1800,
  "Too many verification requests. Please try again later.",
);

export const recordEmailVerificationAttempt = (ip: string): Promise<void> =>
  recordAttempt("email_verification_attempts", ip, 1800);

export const clearEmailVerificationAttempts = (ip: string): Promise<void> =>
  clearAttempts("email_verification_attempts", ip);

// ─── General API 
// 100 requests / 15 minutes

export const generalApiRateLimit = createRateLimiter(
  "api_requests",
  100,
  900,
  "Too many requests. Please slow down.",
);

export default {
  loginRateLimit,
  recordLoginAttempt,
  clearLoginAttempts,
  registerRateLimit,
  recordRegisterAttempt,
  clearRegisterAttempts,
  passwordResetRateLimit,
  recordPasswordResetAttempt,
  clearPasswordResetAttempts,
  emailVerificationRateLimit,
  recordEmailVerificationAttempt,
  clearEmailVerificationAttempts,
  generalApiRateLimit,
};