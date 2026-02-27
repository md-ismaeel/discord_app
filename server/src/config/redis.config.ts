import Redis from "ioredis";
import { getEnv } from "./env.config.js";

const redisConfig = {
  maxRetriesPerRequest: null, // Important for Socket.IO adapter
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) {
      // Only reconnect when the error contains "READONLY"
      return true;
    }
    return false;
  },
};

// Create Redis clients
export const pubClient = new Redis(getEnv("REDIS_URL"), redisConfig);
export const subClient = pubClient.duplicate();

// Track connection status
let isPubReady = false;
let isSubReady = false;

// Pub Client event handlers
pubClient.on("connect", () => {
  console.log("Redis Pub Client connecting...");
});

pubClient.on("ready", () => {
  isPubReady = true;
  console.log("Redis Pub Client ready");
});

pubClient.on("error", (err) => {
  console.error("Redis Pub Client error:", err.message);
});

pubClient.on("close", () => {
  isPubReady = false;
  console.log("Redis Pub Client connection closed");
});

pubClient.on("reconnecting", () => {
  console.log("Redis Pub Client reconnecting...");
});

// Sub Client event handlers
subClient.on("connect", () => {
  console.log("Redis Sub Client connecting...");
});

subClient.on("ready", () => {
  isSubReady = true;
  console.log("Redis Sub Client ready");
});

subClient.on("error", (err) => {
  console.error("Redis Sub Client error:", err.message);
});

subClient.on("close", () => {
  isSubReady = false;
  console.log("Redis Sub Client connection closed");
});

subClient.on("reconnecting", () => {
  console.log("Redis Sub Client reconnecting...");
});

// Health check function
export const isRedisReady = () => {
  return isPubReady && isSubReady;
};

// Wait for Redis to be ready
export const waitForRedis = (timeout = 10000) => {
  return new Promise<void>((resolve, reject) => {
    if (isRedisReady()) {
      return resolve();
    }

    const checkInterval = setInterval(() => {
      if (isRedisReady()) {
        clearInterval(checkInterval);
        clearTimeout(timeoutHandle);
        resolve();
      }
    }, 100);

    const timeoutHandle = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error("Redis connection timeout"));
    }, timeout);
  });
};

// Graceful shutdown
export const closeRedis = async () => {
  console.log("Closing Redis connections...");
  try {
    await Promise.all([pubClient.quit(), subClient.quit()]);
    console.log("Redis connections closed");
  } catch (error) {
    console.error("Error closing Redis connections:", error);
    // Force close if graceful shutdown fails
    pubClient.disconnect();
    subClient.disconnect();
  }
};
