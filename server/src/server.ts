import express, { type Application, type Request, type Response, type NextFunction } from "express";
import http from "http";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import passport from "passport";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";

import { connectDb, closeDb } from "@/config/db.config";
import { initSocket } from "@/socket/socketHandler";
import { validateEnv, getEnv, isProduction } from "@/config/env.config";
import { errorHandler } from "@/middlewares/errorHandler";
import { closeRedis } from "@/config/redis.config";
import "@/config/passport.config";
import routes from "@/routes/routes";

// ─── 1. Validate env before anything else
validateEnv();

// ─── 2. App setup 
const PORT = getEnv("PORT");
const CLIENT_URL = getEnv("CLIENT_URL");
const NODE_ENV = getEnv("NODE_ENV");

const app: Application = express();

// ─── 3. Middleware — ORDER MATTERS

// 3a. CORS — must be first so preflight OPTIONS requests get the right headers
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// 3b. Security headers
// Disable CSP + COEP in dev so the React dev server can load without friction
app.use(
  helmet({
    contentSecurityPolicy: isProduction(),
    crossOriginEmbedderPolicy: isProduction(),
  }),
);

// 3c. Gzip compression — before body parsers so they work on compressed streams
app.use(compression());

// 3d. Request logger — skip in test environment
if (NODE_ENV !== "test") {
  app.use(morgan(isProduction() ? "combined" : "dev"));
}

// 3e. Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 3f. Cookie parser (needed by passport & JWT cookie auth)
app.use(cookieParser());

// 3g. Session — required for passport OAuth flows
app.use(
  session({
    name: "sid",
    secret: getEnv("SESSION_SECRET"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction(),
      // "strict" in production prevents CSRF; "lax" needed in dev for OAuth redirects
      sameSite: isProduction() ? "strict" : "lax",
      maxAge: 1000 * 60 * 60 * 24, // 24 h
    },
  }),
);

// 3h. Passport — must come after session
app.use(passport.initialize());
app.use(passport.session());

// ─── 4. Routes ───

// Health check — intentionally before API routes so it always responds fast
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use("/api/v1/", routes);

// 404 handler — catches any route not matched above
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler — must be the LAST app.use()
// Express identifies error handlers by the 4-argument signature
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  errorHandler(err, req, res, _next);
});

// ─── 5. Startup ──

let server: http.Server | null = null;
let isShuttingDown = false;

const startServer = async (): Promise<void> => {
  console.log("─────────────────────────────────────");
  console.log(`Starting server in ${NODE_ENV} mode`);
  console.log(`Client URL: ${CLIENT_URL}`);
  console.log("─────────────────────────────────────");

  await connectDb();

  server = http.createServer(app);
  await initSocket(server);

  server.listen(PORT, () => {
    console.log(`✅ Server running → http://localhost:${PORT}`);
    console.log(`   API    → http://localhost:${PORT}/api/v1`);
    console.log(`   Health → http://localhost:${PORT}/health`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });
};

// ─── 6. Graceful shutdown
const gracefulShutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully...`);

  // Force-kill if shutdown takes too long (15 s)
  const forceExit = setTimeout(() => {
    console.error("Forced exit after timeout");
    process.exit(1);
  }, 15_000);

  try {
    // 1. Stop accepting new connections
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      console.log("HTTP server closed");
    }

    // 2. Close external services
    await closeRedis();
    // Use closeDb() so the isConnected flag stays in sync
    await closeDb();

    clearTimeout(forceExit);
    console.log("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    clearTimeout(forceExit);
    process.exit(1);
  }
};

// 7. Process event handlers

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err: Error) => {
  console.error("Uncaught Exception:", err);
  void gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("Unhandled Rejection:", reason);
  void gracefulShutdown("UNHANDLED_REJECTION");
});

// ─── 8. Boot ─────

void startServer();