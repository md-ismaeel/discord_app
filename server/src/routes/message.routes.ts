import express from "express";
import { authenticated } from "../middlewares/auth.middleware.js";
import {
  validateBody,
  validateParams,
} from "../middlewares/validate.middleware.js";
import * as messageController from "../controllers/message.controller.js";
import { z } from "zod";

const messageRouter = express.Router();

// ============================================================================
// ALL ROUTES REQUIRE AUTHENTICATION
// ============================================================================
messageRouter.use(authenticated);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createMessageSchema = z.object({
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
  mentions: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
  replyTo: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
});

const updateMessageSchema = z.object({
  content: z
    .string()
    .min(1, "Message content is required")
    .max(2000, "Message cannot exceed 2000 characters"),
});

const addReactionSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
});

const channelIdParamSchema = z.object({
  channelId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid channel ID"),
});

const messageIdParamSchema = z.object({
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid message ID"),
});

const emojiParamSchema = z.object({
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid message ID"),
  emoji: z.string().min(1, "Emoji is required"),
});

// ============================================================================
// CHANNEL MESSAGE ROUTES
// ============================================================================

//    Create a new message in a channel
messageRouter.post(
  "/channels/:channelId/messages",
  validateParams(channelIdParamSchema),
  validateBody(createMessageSchema),
  messageController.createMessage,
);

//    Get messages from a channel (paginated)
messageRouter.get(
  "/channels/:channelId/messages",
  validateParams(channelIdParamSchema),
  messageController.getChannelMessages,
);

//    Get pinned messages in a channel
messageRouter.get(
  "/channels/:channelId/messages/pinned",
  validateParams(channelIdParamSchema),
  messageController.getPinnedMessages,
);

// ============================================================================
// SINGLE MESSAGE ROUTES
// ============================================================================

//    Get a single message by ID
messageRouter.get(
  "/messages/:messageId",
  validateParams(messageIdParamSchema),
  messageController.getMessage,
);

//    Update/Edit a message
messageRouter.patch(
  "/messages/:messageId",
  validateParams(messageIdParamSchema),
  validateBody(updateMessageSchema),
  messageController.updateMessage,
);

//    Delete a message
messageRouter.delete(
  "/messages/:messageId",
  validateParams(messageIdParamSchema),
  messageController.deleteMessage,
);

//    Pin/Unpin a message
messageRouter.patch(
  "/messages/:messageId/pin",
  validateParams(messageIdParamSchema),
  messageController.togglePinMessage,
);

// ============================================================================
// REACTION ROUTES
// ============================================================================

//    Add reaction to a message
messageRouter.post(
  "/messages/:messageId/reactions",
  validateParams(messageIdParamSchema),
  validateBody(addReactionSchema),
  messageController.addReaction,
);

//    Remove reaction from a message
messageRouter.delete(
  "/messages/:messageId/reactions/:emoji",
  validateParams(emojiParamSchema),
  messageController.removeReaction,
);

export { messageRouter };
