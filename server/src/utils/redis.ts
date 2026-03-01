import { pubClient } from "@/config/redis.config";

// ─── Token blacklist ──────────────────────────────────────────────────────────
// Tokens are blacklisted on logout so they can't be reused before expiry.

/**
 * Add a JWT to the blacklist until it expires.
 * @param token     - Raw JWT string
 * @param expiresIn - Remaining TTL in seconds (use the token's `exp` delta)
 */
export const blacklistToken = async (token: string, expiresIn: number): Promise<void> => {
    await pubClient.setex(`blacklist:${token}`, expiresIn, "true");
};

/**
 * Check whether a JWT has been blacklisted.
 * @returns `true` if the token is on the blacklist (i.e. logged out)
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
    const result = await pubClient.get(`blacklist:${token}`);
    return result === "true";
};

// ─── Email verification codes ─────────────────────────────────────────────────

/**
 * Store a short-lived verification code for the given email address.
 * TTL: 10 minutes (600 seconds)
 */
export const storeVerificationCode = async (email: string, code: string): Promise<void> => {
    await pubClient.setex(`verify:${email}`, 600, code);
};

/** Retrieve the stored verification code for an email, or null if expired/absent. */
export const getVerificationCode = async (email: string): Promise<string | null> => {
    return pubClient.get(`verify:${email}`);
};

/** Delete the verification code after it has been used or invalidated. */
export const deleteVerificationCode = async (email: string): Promise<void> => {
    await pubClient.del(`verify:${email}`);
};

// ─── Refresh tokens
// Stored per-user so the latest refresh token can be validated or revoked.

/**
 * Persist a refresh token for a user.
 * TTL: 30 days (2 592 000 seconds)
 */
export const storeRefreshToken = async (userId: string, token: string,): Promise<void> => {
    await pubClient.setex(`refresh:${userId}`, 2_592_000, token);
};

/** Retrieve the stored refresh token for a user, or null if absent/expired. */
export const getRefreshToken = async (userId: string): Promise<string | null> => {
    return pubClient.get(`refresh:${userId}`);
};

/** Delete the refresh token (called on logout or token rotation). */
export const deleteRefreshToken = async (userId: string): Promise<void> => {
    await pubClient.del(`refresh:${userId}`);
};