import jwt from "jsonwebtoken";
import { getEnv } from "../config/env.config.js";

const JWT_SECRET_KEY = getEnv("JWT_SECRET");
const JWT_EXPIRE_KEY = getEnv("JWT_EXPIRE");


//  * Generate JWT token
//  * @param {string} userId - User ID to encode in token
//  * @returns {string} - JWT token
export const generateToken = (userId) => {
    return jwt.sign(
        { userId: userId.toString() },
        JWT_SECRET_KEY,
        { expiresIn: JWT_EXPIRE_KEY }
    );
};


//  * Verify JWT token
//  * @param {string} token - JWT token to verify
//  * @returns {object|null} - Decoded token payload or null if invalid
export const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET_KEY);
    } catch (error) {
        console.error("JWT verification failed:", error.message);
        return null;
    }
};