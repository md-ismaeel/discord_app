import express, { Application } from "express";
import http from "http";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import passport from "passport";
import helmet from "helmet";
import mongoose from "mongoose";

import { connectDb } from "./config/db.config";
import { initSocket } from "./socket/socketHandler";
import { validateEnv, getEnv, isProduction } from "./config/env.config";
import { errorHandler } from "./middlewares/errorHandler";
import { closeRedis } from "./config/redis.config";
import "./config/passport.config";
import routes from "./routes/routes";

// Validate environment variables first
try {
  validateEnv();
} catch (error) {
  console.error("Environment validation failed:", (error as Error).message);
  process.exit(1);
}

const PORT = getEnv("PORT");
const CLIENT_URL = getEnv("CLIENT_URL");

const app: Application = express();

// MIDDLEWARE CONFIGURATION
const corsOrigin = {
  origin: [CLIENT_URL],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ============================================
// CRITICAL: ORDER MATTERS!
// ============================================

// 1. CORS (FIRST)
app.use(cors(corsOrigin));

// 2. BODY PARSERS (BEFORE EVERYTHING ELSE)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 3. Security
app.use(
  helmet({
    contentSecurityPolicy: isProduction(),
    crossOriginEmbedderPolicy: isProduction(),
  })
);

// 4. Cookie Parser
app.use(cookieParser());

// 5. Session configuration (needed for passport OAuth)
app.use(
  session({
    name: "sid",
    secret: getEnv("SESSION_SECRET"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction(),
      sameSite: isProduction() ? "strict" : "lax",
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  })
);

// 6. Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// 7. Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 8. API routes (AFTER ALL MIDDLEWARE)
app.use("/api/v1/", routes);

// 9. 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// 10. Global error handler
app.use(errorHandler);

// SERVER STARTUP
let isShuttingDown = false;
let server: http.Server | null = null;

const startServer = async (): Promise<void> => {
  try {
    console.log("Starting server...");
    console.log(`Environment: ${getEnv("NODE_ENV")}`);
    console.log(`Client URL: ${CLIENT_URL}`);

    await connectDb();
    server = http.createServer(app);
    await initSocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`API: http://localhost:${PORT}/api/v1`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
      } else {
        console.error("Server error:", error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    console.log("Shutdown already in progress...");
    return;
  }

  isShuttingDown = true;
  console.log(`\n${signal} received, starting graceful shutdown...`);

  const forceShutdownTimeout = setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 15000);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            console.error("Error closing HTTP server:", err);
            reject(err);
          } else {
            console.log("HTTP server closed");
            resolve();
          }
        });
      });
    }

    await closeRedis();
    await mongoose.connection.close();
    console.log("MongoDB connection closed");

    clearTimeout(forceShutdownTimeout);
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    clearTimeout(forceShutdownTimeout);
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});

startServer();