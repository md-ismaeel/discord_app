import bcrypt from "bcrypt";
import { pubClient } from "@/config/redis.config";


//  Token blacklist
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

//  Email OTP
// OTP is bcrypt-hashed before storage — even if Redis is compromised the raw
// code cannot be read. A separate attempt counter prevents brute-force.

const EMAIL_OTP_TTL = 600;        // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

/**
 * Hash and store an email OTP. Also resets the attempt counter.
 */
export const storeEmailOtp = async (email: string, otp: string): Promise<void> => {
    const hashed = await bcrypt.hash(otp, 10);
    await pubClient.setex(`otp:email:${email}`, EMAIL_OTP_TTL, hashed);
    await pubClient.del(`otp:email:attempts:${email}`);
};

/**
 * Verify an email OTP. Increments attempt counter on failure.
 * Returns `"ok"` on match, `"invalid"` on mismatch, `"expired"` if gone,
 * or `"locked"` when max attempts are exceeded.
 */
export const verifyEmailOtp = async (
    email: string,
    candidate: string,
): Promise<"ok" | "invalid" | "expired" | "locked"> => {
    const attemptsKey = `otp:email:attempts:${email}`;
    const attempts = parseInt((await pubClient.get(attemptsKey)) ?? "0", 10);
    if (attempts >= OTP_MAX_ATTEMPTS) return "locked";

    const stored = await pubClient.get(`otp:email:${email}`);
    if (!stored) return "expired";

    const match = await bcrypt.compare(candidate, stored);
    if (!match) {
        // Increment attempts with the same TTL so the counter doesn't outlive the OTP
        const ttl = await pubClient.ttl(`otp:email:${email}`);
        if (ttl > 0) await pubClient.setex(attemptsKey, ttl, String(attempts + 1));
        return "invalid";
    }

    // Correct — delete both keys immediately
    await pubClient.del(`otp:email:${email}`);
    await pubClient.del(attemptsKey);
    return "ok";
};

//  Phone OTP
// Mirrors the email OTP helpers but keyed on the phone number.

const PHONE_OTP_TTL = 600; // 10 minutes

/**
 * Hash and store a phone OTP. Also resets the attempt counter.
 */
export const storePhoneOtp = async (phone: string, otp: string): Promise<void> => {
    const hashed = await bcrypt.hash(otp, 10);
    await pubClient.setex(`otp:phone:${phone}`, PHONE_OTP_TTL, hashed);
    await pubClient.del(`otp:phone:attempts:${phone}`);
};

/**
 * Verify a phone OTP. Increments attempt counter on failure.
 * Returns `"ok"` | `"invalid"` | `"expired"` | `"locked"`.
 */
export const verifyPhoneOtp = async (phone: string, candidate: string): Promise<"ok" | "invalid" | "expired" | "locked"> => {
    const attemptsKey = `otp:phone:attempts:${phone}`;
    const attempts = parseInt((await pubClient.get(attemptsKey)) ?? "0", 10);
    if (attempts >= OTP_MAX_ATTEMPTS) return "locked";

    const stored = await pubClient.get(`otp:phone:${phone}`);
    if (!stored) return "expired";

    const match = await bcrypt.compare(candidate, stored);
    if (!match) {
        const ttl = await pubClient.ttl(`otp:phone:${phone}`);
        if (ttl > 0) await pubClient.setex(attemptsKey, ttl, String(attempts + 1));
        return "invalid";
    }

    await pubClient.del(`otp:phone:${phone}`);
    await pubClient.del(attemptsKey);
    return "ok";
};


//  Refresh tokens
// Stored per-user so the latest refresh token can be validated or revoked.

/**
 * Persist a refresh token for a user.
 * TTL: 30 days (2 592 000 seconds) TTL (Time To Live) is the time it takes for a key to expire.
 */
export const storeRefreshToken = async (userId: string, token: string): Promise<void> => {
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