import { pubClient } from "../config/redis.config.js";
import { createApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

//  * Get client IP address (handles proxies and load balancers)
const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.ip ||
    req.connection.remoteAddress ||
    "unknown"
  );
};

//  * Generic rate limiter factory
//  * @param {string} prefix - Key prefix for Redis (e.g., 'login_attempts', 'register_attempts')
//  * @param {number} maxAttempts - Maximum allowed attempts
//  * @param {number} windowSeconds - Time window in seconds
//  * @param {string} errorMessage - Custom error message
const createRateLimiter = (
  prefix,
  maxAttempts,
  windowSeconds,
  errorMessage,
) => {
  return asyncHandler(async (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${prefix}:${ip}`;

    try {
      const attempts = await pubClient.get(key);
      const currentAttempts = attempts ? parseInt(attempts) : 0;

      if (currentAttempts >= maxAttempts) {
        const ttl = await pubClient.ttl(key);
        const minutesLeft = Math.ceil(ttl / 60);

        throw createApiError(
          429,
          errorMessage ||
            `Too many attempts. Please try again in ${minutesLeft} minute(s).`,
          [
            {
              field: "rateLimit",
              message: `Rate limit exceeded. Retry after ${minutesLeft} minute(s)`,
              retryAfter: ttl,
            },
          ],
        );
      }

      // Attach IP to request for later use
      req.clientIp = ip;
      next();
    } catch (error) {
      // If it's already an ApiError, pass it through
      if (error.statusCode) {
        throw error;
      }
      // Redis connection error - log but don't block the request
      console.error(`Rate limit check failed for ${prefix}:`, error);
      next();
    }
  });
};

//  * Record an attempt in Redis
//  * @param {string} prefix - Key prefix
//  * @param {string} ip - Client IP
//  * @param {number} windowSeconds - TTL in seconds
const recordAttempt = async (prefix, ip, windowSeconds) => {
  const key = `${prefix}:${ip}`;

  try {
    const current = await pubClient.get(key);

    if (current) {
      await pubClient.incr(key);
    } else {
      await pubClient.setex(key, windowSeconds, "1");
    }
  } catch (error) {
    console.error(`Failed to record attempt for ${prefix}:`, error);
  }
};

//  * Clear attempts from Redis
//  * @param {string} prefix - Key prefix
//  * @param {string} ip - Client IP
const clearAttempts = async (prefix, ip) => {
  const key = `${prefix}:${ip}`;

  try {
    await pubClient.del(key);
  } catch (error) {
    console.error(`Failed to clear attempts for ${prefix}:`, error);
  }
};

// ==================== LOGIN RATE LIMITING ====================

//  * Rate limit for login attempts
//  * Limit: 5 attempts per 15 minutes
export const loginRateLimit = createRateLimiter(
  "login_attempts",
  5,
  900, // 15 minutes
  "Too many login attempts. Please try again in a few minutes.",
);

//  * Record a failed login attempt
export const recordLoginAttempt = async (ip) => {
  await recordAttempt("login_attempts", ip, 900);
};

//  * Clear login attempts (called after successful login)
export const clearLoginAttempts = async (ip) => {
  await clearAttempts("login_attempts", ip);
};

// ==================== REGISTER RATE LIMITING ====================

//  * Rate limit for registration attempts
//  * Limit: 3 attempts per 15 minutes
export const registerRateLimit = createRateLimiter(
  "register_attempts",
  3,
  900, // 15 minutes
  "Too many registration attempts. Please try again in a few minutes.",
);

//  * Record a failed registration attempt
export const recordRegisterAttempt = async (ip) => {
  await recordAttempt("register_attempts", ip, 900);
};

//  * Clear registration attempts (called after successful registration)
export const clearRegisterAttempts = async (ip) => {
  await clearAttempts("register_attempts", ip);
};

// ==================== PASSWORD RESET RATE LIMITING ====================

//  * Rate limit for password reset requests
//  * Limit: 3 attempts per 1 hour
export const passwordResetRateLimit = createRateLimiter(
  "password_reset_attempts",
  3,
  3600, // 1 hour
  "Too many password reset requests. Please try again later.",
);

export const recordPasswordResetAttempt = async (ip) => {
  await recordAttempt("password_reset_attempts", ip, 3600);
};

export const clearPasswordResetAttempts = async (ip) => {
  await clearAttempts("password_reset_attempts", ip);
};

// ==================== EMAIL VERIFICATION RATE LIMITING ====================

//  * Rate limit for email verification code requests
//  * Limit: 5 attempts per 30 minutes
export const emailVerificationRateLimit = createRateLimiter(
  "email_verification_attempts",
  5,
  1800, // 30 minutes
  "Too many verification requests. Please try again later.",
);

export const recordEmailVerificationAttempt = async (ip) => {
  await recordAttempt("email_verification_attempts", ip, 1800);
};

export const clearEmailVerificationAttempts = async (ip) => {
  await clearAttempts("email_verification_attempts", ip);
};

// ==================== GENERAL API RATE LIMITING ====================

//  * General API rate limiter
//  * Limit: 100 requests per 15 minutes
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
