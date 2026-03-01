import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import {
  validateBody,
  validateParams,
} from "@/middlewares/validate.middleware";
import * as messageController from "@/controllers/message.controller";
import { channelIdParamSchema, emojiParamSchema, messageIdParamSchema } from "@/validations/common";
import { sendMessageSchema, editMessageSchema, getMessagesSchema, reactionSchema } from "@/validations/message.validation";

const messageRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
messageRouter.use(authenticated);

// CHANNEL MESSAGE ROUTES

//    Create a new message in a channel
messageRouter.post("/channels/:channelId/messages",
  validateParams(channelIdParamSchema),
  validateBody(sendMessageSchema),
  messageController.createMessage,
);

//    Get messages from a channel (paginated)
messageRouter.get("/channels/:channelId/messages",
  validateParams(channelIdParamSchema),
  messageController.getChannelMessages,
);

//    Get pinned messages in a channel
messageRouter.get("/channels/:channelId/messages/pinned",
  validateParams(channelIdParamSchema),
  messageController.getPinnedMessages,
);

// SINGLE MESSAGE ROUTES

//    Get a single message by ID
messageRouter.get("/messages/:messageId",
  validateParams(messageIdParamSchema),
  messageController.getMessage,
);

//    Update/Edit a message
messageRouter.patch("/messages/:messageId",
  validateParams(messageIdParamSchema),
  validateBody(editMessageSchema),
  messageController.updateMessage,
);

//    Delete a message
messageRouter.delete(
  "/messages/:messageId",
  validateParams(messageIdParamSchema),
  messageController.deleteMessage,
);

// get messages 
messageRouter.get("/",
  validateParams(getMessagesSchema),
  messageController.getMessage,
);

//    Pin/Unpin a message
messageRouter.patch(
  "/messages/:messageId/pin",
  validateParams(messageIdParamSchema),
  messageController.togglePinMessage,
);

// REACTION ROUTES

//    Add reaction to a message
messageRouter.post(
  "/messages/:messageId/reactions",
  validateParams(messageIdParamSchema),
  validateBody(reactionSchema),
  messageController.addReaction,
);

//    Remove reaction from a message
messageRouter.delete(
  "/messages/:messageId/reactions/:emoji",
  validateParams(emojiParamSchema),
  messageController.removeReaction,
);

export { messageRouter };