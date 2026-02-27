import { config } from "dotenv";

config();

interface Env {
  MONGODB_URI: string;
  SESSION_SECRET: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  PORT: string;
  CLIENT_URL: string;
  NODE_ENV: string;
  JWT_EXPIRE: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FACEBOOK_APP_ID: string;
  FACEBOOK_APP_SECRET: string;
}

const requiredEnvVars = [
  "MONGODB_URI",
  "SESSION_SECRET",
  "REDIS_URL",
  "JWT_SECRET",
];

const optionalEnvVars: Env = {
  PORT: "5000",
  CLIENT_URL: "http://localhost:5173",
  NODE_ENV: "development",
  JWT_EXPIRE: "7d",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  FACEBOOK_APP_ID: "",
  FACEBOOK_APP_SECRET: "",
  MONGODB_URI: "",
  SESSION_SECRET: "",
  REDIS_URL: "",
  JWT_SECRET: "",
};

export const validateEnv = () => {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
};

export const getEnv = (key: string, fallback: any = null) => {
  return process.env[key] || optionalEnvVars[key as keyof Env] || fallback;
};

export const isProduction = () => getEnv("NODE_ENV") === "production";
export const isDevelopment = () => getEnv("NODE_ENV") === "development";
