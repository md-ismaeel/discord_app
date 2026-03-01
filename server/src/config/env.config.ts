import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root regardless of where the process was started from
config({ path: path.resolve(__dirname, "../../.env") });

// ─── Types
export interface Env {
  // Required
  MONGODB_URI: string;
  SESSION_SECRET: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  // Optional — have sensible defaults
  PORT: string;
  CLIENT_URL: string;
  NODE_ENV: "development" | "production" | "test";
  JWT_EXPIRE: string;
  COOKIE_MAX_AGE: string;
  // OAuth — optional; strategies are skipped when empty
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FACEBOOK_APP_ID: string;
  FACEBOOK_APP_SECRET: string;
  // Cloudinary — optional
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
}

//  Required keys — server will not start without these 
const REQUIRED_ENV_KEYS: ReadonlyArray<keyof Env> = [
  "MONGODB_URI",
  "SESSION_SECRET",
  "REDIS_URL",
  "JWT_SECRET",
];

//  Defaults for optional keys
// IMPORTANT: required keys must NOT appear here with empty strings — that would
// let an empty process.env value silently pass the validator.

type OptionalEnv = Omit<Env, (typeof REQUIRED_ENV_KEYS)[number]>;

const DEFAULTS: OptionalEnv = {
  PORT: "5000",
  CLIENT_URL: "http://localhost:5173",
  NODE_ENV: "development",
  JWT_EXPIRE: "7d",
  COOKIE_MAX_AGE: "604800000", // 7 days in ms
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  FACEBOOK_APP_ID: "",
  FACEBOOK_APP_SECRET: "",
  CLOUDINARY_CLOUD_NAME: "",
  CLOUDINARY_API_KEY: "",
  CLOUDINARY_API_SECRET: "",
};

//  Validation
export const validateEnv = (): void => {
  const missing = REQUIRED_ENV_KEYS.filter(
    (key) => !process.env[key]?.trim(),
  );

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("Environment variables validated");
};

//  Typed getter
// Returns process.env value → DEFAULTS fallback → provided fallback
// The overloads give callers a typed return when they pass a key from Env.
export function getEnv<K extends keyof Env>(key: K): Env[K];
export function getEnv<K extends keyof Env>(key: K, fallback: Env[K]): Env[K];
export function getEnv(key: string, fallback?: string): string;

export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? (DEFAULTS as Record<string, string>)[key] ?? fallback ?? "";
  return value;
}

//  Convenience helpers
export const isProduction = (): boolean => getEnv("NODE_ENV") === "production";
export const isDevelopment = (): boolean => getEnv("NODE_ENV") === "development";
export const isTest = (): boolean => getEnv("NODE_ENV") === "test";