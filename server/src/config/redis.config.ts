import Redis, { type RedisOptions } from "ioredis";
import { getEnv } from "./env.config.js";

// ─── Config 
const redisOptions: RedisOptions = {
  // Must be null for Socket.IO adapter — it uses blocking commands
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
  retryStrategy: (times: number): number => {
    // Exponential back-off capped at 2 s
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis retry attempt ${times}, next in ${delay}ms`);
    return delay;
  },
  reconnectOnError: (err: Error): boolean => {
    // Reconnect only on READONLY errors (happens with Redis Sentinel failover)
    return err.message.includes("READONLY");
  },
};

//  Clients
// pubClient  — used for publishing / general commands
// subClient  — dedicated subscribe client (ioredis requirement for pub/sub

export const pubClient = new Redis(getEnv("REDIS_URL"), redisOptions);
export const subClient = pubClient.duplicate();

//  Connection state 
let isPubReady = false;
let isSubReady = false;

//  Pub client events 
pubClient.on("connect", () => console.log("Redis pub: connecting..."));
pubClient.on("ready", () => {
  isPubReady = true;
  console.log("Redis pub client ready");
});
pubClient.on("error", (err: Error) =>
  console.error("Redis pub error:", err.message),
);
pubClient.on("close", () => {
  isPubReady = false;
  console.warn("Redis pub connection closed");
});
pubClient.on("reconnecting", () => console.log("Redis pub: reconnecting..."));

//  Sub client events
subClient.on("connect", () => console.log("Redis sub: connecting..."));
subClient.on("ready", () => {
  isSubReady = true;
  console.log("Redis sub client ready");
});
subClient.on("error", (err: Error) =>
  console.error("Redis sub error:", err.message),
);
subClient.on("close", () => {
  isSubReady = false;
  console.warn("Redis sub connection closed");
});
subClient.on("reconnecting", () => console.log("Redis sub: reconnecting..."));

//  Health helpers
export const isRedisReady = (): boolean => isPubReady && isSubReady;

/**
 * Resolves when both clients are ready, or rejects after `timeout` ms.
 * Default timeout is 10 s.
 */
export const waitForRedis = (timeout = 10_000): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (isRedisReady()) {
      resolve();
      return;
    }

    const interval = setInterval(() => {
      if (isRedisReady()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Redis connection timed out after ${timeout}ms`));
    }, timeout);
  });

//  Graceful shutdown
export const closeRedis = async (): Promise<void> => {
  console.log("Closing Redis connections...");
  try {
    // QUIT sends the QUIT command and waits for the server ack
    await Promise.all([pubClient.quit(), subClient.quit()]);
    console.log(" Redis connections closed");
  } catch (err) {
    console.error("Error closing Redis gracefully, forcing disconnect:", err);
    // Forcefully destroy TCP sockets if QUIT fails
    pubClient.disconnect();
    subClient.disconnect();
  }
};