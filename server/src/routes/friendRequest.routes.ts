import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import { validateParams } from "@/middlewares/validate.middleware";
import * as friendRequestController from "@/controllers/friendRequest.controller";
import { sendFriendRequestSchema, respondFriendRequestSchema, friendRequestIdParamSchema } from "@/validations/friendRequest.validation.js";

const friendRequestRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
friendRequestRouter.use(authenticated);

//    Get all friend requests (sent and received)
friendRequestRouter.get("/", friendRequestController.getAllFriendRequests);

//    Get pending friend requests (received)
friendRequestRouter.get("/pending", friendRequestController.getPendingRequests);

//    Get sent friend requests
friendRequestRouter.get("/sent", friendRequestController.getSentRequests);

//    Send a friend request
friendRequestRouter.post("/:userId",
  validateParams(sendFriendRequestSchema),
  friendRequestController.sendFriendRequest,
);

//    Accept a friend request
friendRequestRouter.patch("/:requestId/accept",
  validateParams(respondFriendRequestSchema),
  friendRequestController.acceptFriendRequest,
);

//    Decline a friend request
friendRequestRouter.patch("/:requestId/decline",
  validateParams(respondFriendRequestSchema),
  friendRequestController.declineFriendRequest,
);

//    Cancel a sent friend request
friendRequestRouter.delete("/:requestId",
  validateParams(friendRequestIdParamSchema),
  friendRequestController.cancelFriendRequest,
);

export { friendRequestRouter };