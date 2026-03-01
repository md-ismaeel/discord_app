import bcrypt from "bcrypt";

// 12 rounds ≈ ~300ms on modern hardware — a good balance between security and UX.
const SALT_ROUNDS = 12;

//  * Hash a plain-text password using bcrypt.
export const hashPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    return bcrypt.hash(password, salt);
};


//  * Compare a plain-text password against a stored bcrypt hash
export const comparePassword = async (password: string, hashedPassword: string): Promise<boolean> => {
    return bcrypt.compare(password, hashedPassword);
};