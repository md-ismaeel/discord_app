import express from "express";
import { pubClient } from "../config/redis.config.js";
import { authenticated } from "../middlewares/auth.middleware.js";
import { ApiError } from "../utils/ApiError.js";
import type { Request, Response, NextFunction } from "express";

const debugRouter = express.Router();

// All debug routes expose raw Redis data (tokens, user sessions, cached payloads).
// They must NEVER be accessible in production, and require admin auth in dev/staging.

const isDevOrStaging = ["development", "staging"].includes(
  process.env.NODE_ENV ?? "",
);

// Block entirely in production
debugRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!isDevOrStaging) {
    return next(
      new ApiError(404, "Not found."), // Return 404, not 403, to avoid leaking route existence
    );
  }
  next();
});

// Require authentication even in dev/staging
debugRouter.use(authenticated);

// GET /api/v1/debug/cache — dump all cache keys and values
debugRouter.get("/cache", async (_req: Request, res: Response) => {
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
            return JSON.parse(value!);
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

// GET /api/v1/debug/cache/:key — inspect a single cache key
debugRouter.get("/cache/:key", async (req: Request, res: Response) => {
  const value = await pubClient.get(req.params.key as string);
  const ttl = await pubClient.ttl(req.params.key as string);

  res.json({
    key: req.params.key,
    ttl: `${ttl}s`,
    exists: value !== null,
    value: (() => {
      try {
        return JSON.parse(value!);
      } catch {
        return value;
      }
    })(),
  });
});

// DELETE /api/v1/debug/cache — flush entire cache
debugRouter.delete("/cache", async (_req: Request, res: Response) => {
  await pubClient.flushall();
  res.json({ message: "Cache cleared" });
});

export { debugRouter };