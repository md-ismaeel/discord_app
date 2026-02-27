import express from "express";
import { pubClient } from "../config/redis.config.js";

const debugRouter = express.Router();

// GET /api/v1/debug/cache
debugRouter.get("/cache", async (req, res) => {
  const keys = await pubClient.keys("*");

  const data = await Promise.all(
    keys.map(async (key) => {
      const value = await pubClient.get(key);
      const ttl = await pubClient.ttl(key);
      return {
        key,
        ttl: `${ttl}s`,
        value: (() => {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        })(),
      };
    }),
  );

  res.json({
    total: keys.length,
    cache: data,
    message: "Cache fetched successfully",
  });
});

// GET /api/v1/debug/cache/:key
debugRouter.get("/cache/:key", async (req, res) => {
  const value = await pubClient.get(req.params.key);
  const ttl = await pubClient.ttl(req.params.key);

  res.json({
    key: req.params.key,
    ttl: `${ttl}s`,
    exists: value !== null,
    value: (() => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    })(),
  });
});

// DELETE /api/v1/debug/cache — flush all cache
debugRouter.delete("/cache", async (req, res) => {
  await pubClient.flushall();
  res.json({ message: "Cache cleared" });
});

export { debugRouter };
