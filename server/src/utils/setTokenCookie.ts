import type { Response, CookieOptions } from "express";
import { isProduction } from "@/config/env.config";

//  Constants
const COOKIE_NAME = "token";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days


/**
 * Attach the JWT as an HttpOnly cookie on the response.
 *
 * Security properties:
 *  - httpOnly: prevents JavaScript access (mitigates XSS token theft)
 *  - secure:   HTTPS-only in production
 *  - sameSite: "strict" in production (CSRF protection), "lax" in dev
 *              (needed for OAuth redirect flows that cross origins)
 */
export const setTokenCookie = (res: Response, token: string): void => {
    const options: CookieOptions = {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? "strict" : "lax",
        maxAge: COOKIE_MAX_AGE_MS,
    };
    res.cookie(COOKIE_NAME, token, options);
};

/**
 * Clear the auth cookie (used on logout).
 * Must use the same options as setTokenCookie so the browser honours the clear.
 */
export const clearTokenCookie = (res: Response): void => {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? "strict" : "lax",
    });
};