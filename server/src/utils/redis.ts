import { pubClient } from "../config/redis.config.js";

export const blacklistToken = async (token, expiresIn) => {
    await pubClient.setex(`blacklist:${token}`, expiresIn, "true");
};

export const isTokenBlacklisted = async (token) => {
    const result = await pubClient.get(`blacklist:${token}`);
    return result === "true";
};

export const storeVerificationCode = async (email, code) => {
    await pubClient.setex(`verify:${email}`, 600, code); // 10 minutes
};

export const getVerificationCode = async (email) => {
    return await pubClient.get(`verify:${email}`);
};

export const deleteVerificationCode = async (email) => {
    await pubClient.del(`verify:${email}`);
};

export const storeRefreshToken = async (userId, token) => {
    await pubClient.setex(`refresh:${userId}`, 2592000, token); // 30 days
};

export const getRefreshToken = async (userId) => {
    return await pubClient.get(`refresh:${userId}`);
};

export const deleteRefreshToken = async (userId) => {
    await pubClient.del(`refresh:${userId}`);
};