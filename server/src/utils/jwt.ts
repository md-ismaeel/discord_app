import jwt, { type SignOptions, type JwtPayload } from "jsonwebtoken";
import { getEnv } from "@/config/env.config";
import { ApiError } from "./ApiError.js";

// ─── Types
export interface TokenPayload extends JwtPayload {
    userId: string;
}

// ─── Config
// Read once at module load — avoids repeated getEnv calls on every request.

const JWT_SECRET: string = getEnv("JWT_SECRET");
const JWT_EXPIRE: string = getEnv("JWT_EXPIRE");

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
}

// ─── Helpers

/**
 * Sign a JWT containing the given userId.
 * @param userId - MongoDB ObjectId (string or ObjectId — .toString() is safe either way)
 * @returns Signed JWT string
 */
export const generateToken = (userId: string | { toString(): string }): string => {
    const options: SignOptions = {
        expiresIn: JWT_EXPIRE as SignOptions["expiresIn"],
    };
    return jwt.sign({ userId: userId.toString() }, JWT_SECRET, options);
};

/**
 * Verify and decode a JWT.
 * Throws `ApiError.unauthorized` with a specific message for expired / invalid tokens
 * so the auth middleware can surface the right message without catching raw JWT errors.
 *
 * @param token - Raw JWT string
 * @returns Decoded payload with `userId`
 */
export const verifyToken = (token: string): TokenPayload => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;

        if (!decoded.userId) {
            throw ApiError.unauthorized("Token payload is missing userId.");
        }

        return decoded;
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            throw ApiError.unauthorized("Token has expired. Please log in again.");
        }
        if (err instanceof jwt.JsonWebTokenError) {
            throw ApiError.unauthorized("Invalid token. Please log in again.");
        }
        // Re-throw ApiErrors and any other unexpected errors as-is
        throw err;
    }
};