import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import http from "http";
import { pubClient, subClient, waitForRedis } from "../config/redis.config";
import { getEnv } from "../config/env.config";
import { verifyToken } from "../utils/jwt";
import { UserModel } from "../models/user.model";
import { IUser } from "../types/models";

// Extend Socket interface
interface AuthenticatedSocket extends Socket {
  userId: string;
  user: {
    _id: string;
    username: string;
    name: string;
    avatar: string;
    status: string;
  };
}

let io: Server | null = null;

export const initSocket = async (httpServer: http.Server): Promise<Server> => {
  try {
    console.log("Waiting for Redis to be ready...");
    await waitForRedis();
    console.log("Redis is ready, initializing Socket.IO...");

    io = new Server(httpServer, {
      cors: {
        origin: getEnv("CLIENT_URL"),
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
      connectTimeout: 45000,
      maxHttpBufferSize: 1e6,
    });

    io.adapter(createAdapter(pubClient, subClient));
    console.log("Socket.IO Redis adapter initialized");

    // Authentication middleware
    io.use(async (socket: Socket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.split(" ")[1];

        if (!token) {
          return next(new Error("Authentication error: No token provided"));
        }

        const decoded = verifyToken(token);
        const user = await UserModel.findById(decoded.userId).select("-password");

        if (!user) {
          return next(new Error("Authentication error: User not found"));
        }

        const authSocket = socket as AuthenticatedSocket;
        authSocket.userId = user._id.toString();
        authSocket.user = {
          _id: user._id.toString(),
          username: user.username || user.name,
          name: user.name,
          avatar: user.avatar,
          status: user.status,
        };

        next();
      } catch (error: any) {
        console.error("Socket authentication error:", error.message);
        next(new Error("Authentication error: Invalid token"));
      }
    });

    io.on("connection", (socket: Socket) => {
      const authSocket = socket as AuthenticatedSocket;
      console.log(`User connected: ${authSocket.user.username} (${socket.id})`);

      socket.join(`user:${authSocket.userId}`);

      UserModel.findByIdAndUpdate(authSocket.userId, {
        status: "online",
        lastSeen: new Date(),
      }).catch((err) => console.error("Error updating user status:", err));

      // All your socket event handlers here...
      // (Keep the same as before, just with proper typing)

      socket.on("disconnect", async (reason: string) => {
        console.log(
          `User disconnected: ${authSocket.user.username} (Reason: ${reason})`
        );

        try {
          await UserModel.findByIdAndUpdate(authSocket.userId, {
            status: "offline",
            lastSeen: new Date(),
          });
        } catch (error) {
          console.error("Error handling disconnect:", error);
        }
      });
    });

    console.log("✅ Socket.IO initialized successfully");
    return io;
  } catch (error) {
    console.error("Failed to initialize Socket.IO:", error);
    throw error;
  }
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket first.");
  }
  return io;
};

export const emitToUser = (userId: string, event: string, data: any): void => {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
};

export const emitToServer = (serverId: string, event: string, data: any): void => {
  if (!io) return;
  io.to(`server:${serverId}`).emit(event, data);
};

export const emitToChannel = (channelId: string, event: string, data: any): void => {
  if (!io) return;
  io.to(`channel:${channelId}`).emit(event, data);
};