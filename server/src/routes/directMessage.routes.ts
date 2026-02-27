import express from "express";
import { authenticated } from "../middlewares/auth.middleware.js";
import {
  validateBody,
  validateParams,
} from "../middlewares/validate.middleware.js";
import * as directMessageController from "../controllers/directMessage.controller.js";
import { z } from "zod";

const directMessageRouter = express.Router();

// ============================================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// ============================================================================
directMessageRouter.use(authenticated);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const sendMessageSchema = z.object({
  content: z
    .string()
    .min(1, "Message content is required")
    .max(2000, "Message cannot exceed 2000 characters"),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        filename: z.string(),
        size: z.number(),
        type: z.string(),
      }),
    )
    .optional(),
});

const editMessageSchema = z.object({
  content: z
    .string()
    .min(1, "Message content is required")
    .max(2000, "Message cannot exceed 2000 characters"),
});

const userIdParamSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID"),
});

const recipientIdParamSchema = z.object({
  recipientId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid recipient ID"),
});

const messageIdParamSchema = z.object({
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid message ID"),
});

// ============================================================================
// DIRECT MESSAGE ROUTES
// ============================================================================

//    Get all conversations for current user
directMessageRouter.get("/", directMessageController.getConversations);

//    Get unread message count
directMessageRouter.get(
  "/unread/count",
  directMessageController.getUnreadCount,
);

//    Send a direct message
directMessageRouter.post(
  "/:recipientId",
  validateParams(recipientIdParamSchema),
  validateBody(sendMessageSchema),
  directMessageController.sendDirectMessage,
);

//    Get conversation between two users (paginated)
directMessageRouter.get(
  "/:userId",
  validateParams(userIdParamSchema),
  directMessageController.getConversation,
);

//    Delete entire conversation with a user
directMessageRouter.delete(
  "/:userId",
  validateParams(userIdParamSchema),
  directMessageController.deleteConversation,
);

//    Mark messages as read
directMessageRouter.patch(
  "/:userId/read",
  validateParams(userIdParamSchema),
  directMessageController.markAsRead,
);

// ============================================================================
// SINGLE MESSAGE OPERATIONS
// ============================================================================

//    Edit a direct message
directMessageRouter.patch(
  "/message/:messageId",
  validateParams(messageIdParamSchema),
  validateBody(editMessageSchema),
  directMessageController.editDirectMessage,
);

//    Delete a direct message
directMessageRouter.delete(
  "/message/:messageId",
  validateParams(messageIdParamSchema),
  directMessageController.deleteDirectMessage,
);

export { directMessageRouter };
