import express from "express";
import { authenticated } from "../middlewares/auth.middleware.js";
import { validateParams } from "../middlewares/validate.middleware.js";
import * as friendRequestController from "../controllers/friendRequest.controller.js";
import { z } from "zod";

const friendRequestRouter = express.Router();

// ============================================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// ============================================================================
friendRequestRouter.use(authenticated);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const userIdParamSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID"),
});

const requestIdParamSchema = z.object({
  requestId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid request ID"),
});

// ============================================================================
// FRIEND REQUEST ROUTES
// ============================================================================

//    Get all friend requests (sent and received)
friendRequestRouter.get("/", friendRequestController.getAllFriendRequests);

//    Get pending friend requests (received)
friendRequestRouter.get("/pending", friendRequestController.getPendingRequests);

//    Get sent friend requests
friendRequestRouter.get("/sent", friendRequestController.getSentRequests);

//    Send a friend request
friendRequestRouter.post(
  "/:userId",
  validateParams(userIdParamSchema),
  friendRequestController.sendFriendRequest,
);

//    Accept a friend request
friendRequestRouter.patch(
  "/:requestId/accept",
  validateParams(requestIdParamSchema),
  friendRequestController.acceptFriendRequest,
);

//    Decline a friend request
friendRequestRouter.patch(
  "/:requestId/decline",
  validateParams(requestIdParamSchema),
  friendRequestController.declineFriendRequest,
);

//    Cancel a sent friend request
friendRequestRouter.delete(
  "/:requestId",
  validateParams(requestIdParamSchema),
  friendRequestController.cancelFriendRequest,
);

export { friendRequestRouter };
