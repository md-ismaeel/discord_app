import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type http from "http";
import { pubClient, subClient, waitForRedis } from "@/config/redis.config";
import { getEnv } from "@/config/env.config";
import { verifyToken } from "@/utils/jwt.js";
import { UserModel } from "../models/user.model";
import type { IUser } from "../types/models";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuthenticatedSocket extends Socket {
  userId: string;
  user: Pick<IUser, "username" | "name" | "avatar" | "status"> & {
    _id: string;
  };
}

// Narrow helper — avoids casting in every handler
function isAuthenticated(socket: Socket): socket is AuthenticatedSocket {
  return "userId" in socket;
}

// ─── Module-level singleton ───────────────────────────────────────────────────
let io: Server | null = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
export const initSocket = async (httpServer: http.Server): Promise<Server> => {
  console.log("Waiting for Redis to be ready...");
  await waitForRedis();
  console.log("Redis ready — initialising Socket.IO..."); 

  io = new Server(httpServer, {
    cors: {
      origin: getEnv("CLIENT_URL"),
      credentials: true,
      methods: ["GET", "POST"],
    },
    // Prefer WebSocket, fall back to polling for firewalled clients
    transports: ["websocket", "polling"],
    pingTimeout: 60_000,
    pingInterval: 25_000,
    connectTimeout: 45_000,
    // 1 MB max payload — prevents memory-pressure from large uploads
    maxHttpBufferSize: 1e6,
  });

  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter attached");

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const token: string | undefined =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        next(new Error("Authentication error: no token provided"));
        return;
      }

      const decoded = verifyToken(token);

      if (!decoded || typeof decoded === "string") {
        next(new Error("Authentication error: invalid token"));
        return;
      }

      const user = await UserModel.findById(decoded.userId).select("-password").lean<IUser>();

      if (!user) {
        next(new Error("Authentication error: user not found"));
        return;
      }

      // Attach user data directly to the socket instance
      const authSocket = socket as AuthenticatedSocket;
      authSocket.userId = user._id.toString();
      authSocket.user = {
        _id: user._id.toString(),
        // GitHub users may only have `username`, fall back to `name`
        username: user.username ?? user.name,
        name: user.name,
        avatar: user.avatar,
        status: user.status,
      };

      next();
    } catch (err) {
      console.error("Socket auth error:", (err as Error).message);
      next(new Error("Authentication error: invalid token"));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    if (!isAuthenticated(socket)) return;

    const { userId, user } = socket;
    console.log(`[socket] ${user.username} connected (${socket.id})`);

    // Each user has a personal room for direct targeted events
    void socket.join(`user:${userId}`);

    // Mark online — fire-and-forget, log errors
    UserModel.findByIdAndUpdate(userId, {
      status: "online",
      lastSeen: new Date(),
    }).catch((err: Error) =>
      console.error("Error setting user online:", err.message),
    );

    // ── Room join helpers ──────────────────────────────────────────────────

    socket.on("join:server", (serverId: string) => {
      void socket.join(`server:${serverId}`);
    });

    socket.on("leave:server", (serverId: string) => {
      void socket.leave(`server:${serverId}`);
    });

    socket.on("join:channel", (channelId: string) => {
      void socket.join(`channel:${channelId}`);
    });

    socket.on("leave:channel", (channelId: string) => {
      void socket.leave(`channel:${channelId}`);
    });

    // ── Disconnect ─────────────────────────────────────────────────────────

    socket.on("disconnect", async (reason: string) => {
      console.log(`[socket] ${user.username} disconnected (${reason})`);

      try {
        await UserModel.findByIdAndUpdate(userId, {
          status: "offline",
          lastSeen: new Date(),
        });
      } catch (err) {
        console.error("Error setting user offline:", (err as Error).message);
      }
    });
  });

  console.log("Socket.IO initialised successfully");
  return io;
};

// ─── Accessors ────────────────────────────────────────────────────────────────
export const getIO = (): Server => {
  if (!io) throw new Error("Socket.IO not initialised — call initSocket first");
  return io;
};

// ─── Emit helpers ─────────────────────────────────────────────────────────────
// Typed `data` prevents silent `any` from leaking across the codebase.
// Callers can pass their own event-payload map if they want stricter types.

export const emitToUser = (userId: string, event: string, data: unknown): void => {
  io?.to(`user:${userId}`).emit(event, data);
};

export const emitToServer = (serverId: string, event: string, data: unknown): void => {
  io?.to(`server:${serverId}`).emit(event, data);
};

export const emitToChannel = (channelId: string, event: string, data: unknown): void => {
  io?.to(`channel:${channelId}`).emit(event, data);
};