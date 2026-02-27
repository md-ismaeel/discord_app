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

// Debug middleware (can remove in production)
router.use((req, res, next) => {
  if (req.method !== "GET") {
    console.log(`[${req.method}] ${req.url} - Body:`, req.body);
  }
  next();
});

// Authentication routes
router.use("/auth", authRouter);

// User routes (profile, friends, blocked users)
router.use("/users", userRouter);

// Server routes (includes channels)
router.use("/servers", serverRouter);

// Message routes (channel messages)
router.use("/", messageRouter);

// Direct message routes
router.use("/direct-messages", directMessageRouter);

// Friend request routes
router.use("/friend-requests", friendRequestRouter);

// Invite routes (server invitations)
router.use("/invites", inviteRouter);

// Role routes (permission management)
router.use("/roles", roleRouter);

// Debug routes
router.use("/debug", debugRouter);

export default router;
