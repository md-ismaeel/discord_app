import bcrypt from "bcrypt";

// ─── Constants
// 12 rounds ≈ ~300ms on modern hardware — a good balance between security and UX.
// Increase to 13–14 for higher-security contexts (admin accounts, etc.).
const SALT_ROUNDS = 12;

// ─── Helpers

/**
 * Hash a plain-text password using bcrypt.
 * @param password - Plain-text password from the user
 * @returns Bcrypt hash string to store in the database
 */
export const hashPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    return bcrypt.hash(password, salt);
};

/**
 * Compare a plain-text password against a stored bcrypt hash.
 * @param password       - Plain-text password from the login request
 * @param hashedPassword - Bcrypt hash stored in the database
 * @returns `true` if the password matches, `false` otherwise
 */
export const comparePassword = async (
    password: string,
    hashedPassword: string,
): Promise<boolean> => {
    return bcrypt.compare(password, hashedPassword);
};