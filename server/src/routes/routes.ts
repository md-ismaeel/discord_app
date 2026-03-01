import express from "express";
import { authRouter } from "./auth.routes.js";
import { userRouter } from "./user.routes.js";
import { serverRouter } from "./server.routes.js";
import { messageRouter } from "./message.routes.js";
import { directMessageRouter } from "./directMessage.routes.js";
import { friendRequestRouter } from "./friendRequest.routes.js";
import { inviteRouter } from "./invite.routes.js";
import { roleRouter } from "./role.routes.js";
import { debugRouter } from "./debug.routes.js";

const router = express.Router();

// REQUEST LOGGER (remove or guard behind NODE_ENV check in production)
if (process.env.NODE_ENV !== "production") {
  router.use((req, _res, next) => {
    if (req.method !== "GET") {
      console.log(`[${req.method}] ${req.url} - Body:`, req.body);
    }
    next();
  });
}

// Auth — login, register, OAuth, refresh, logout
router.use("/auth", authRouter);

// Users — profile, avatar, friends, blocking, search
router.use("/users", userRouter);

// Servers — CRUD, members, channels, invites (server-scoped), roles (server-scoped)
router.use("/servers", serverRouter);

// Message routes 
router.use("/", messageRouter)

// Direct messages — conversations, unread counts, single message ops
router.use("/direct-messages", directMessageRouter);

// Friend requests — send, accept, decline, cancel
router.use("/friend-requests", friendRequestRouter);

// Invites — public preview, join-by-code, revoke, cleanup
// Server-scoped invite creation/listing lives in /servers/:serverId/invites
router.use("/invites", inviteRouter);

// Roles — individual role CRUD, member-role assignment
// Server-scoped role creation/listing lives in /servers/:serverId/roles
router.use("/roles", roleRouter);

// Debug — Redis cache inspection (blocked in production, auth-gated in dev)
router.use("/debug", debugRouter);

export default router;