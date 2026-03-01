import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import { validateBody, validateParams } from "@/middlewares/validate.middleware";
import * as directMessageController from "@/controllers/directMessage.controller";
import { sendDirectMessageSchema, editDirectMessageSchema } from "@validations/directMessahe.validation";
import { messageIdParamSchema, userIdParamSchema } from "@validations/common";

const directMessageRouter = express.Router();

directMessageRouter.use(authenticated);

//    Get all conversations for current user
directMessageRouter.get("/", directMessageController.getConversations);

//    Get unread message count
//    NOTE: registered before /:userId to prevent "unread" matching as a userId
directMessageRouter.get("/unread/count", directMessageController.getUnreadCount);

//   Edit a direct message
directMessageRouter.patch("/message/:messageId",
  validateParams(messageIdParamSchema),
  validateBody(editDirectMessageSchema),
  directMessageController.editDirectMessage,
);

//    Delete a direct message
directMessageRouter.delete("/message/:messageId",
  validateParams(messageIdParamSchema),
  directMessageController.deleteDirectMessage,
);

//    Send a direct message to a recipient
directMessageRouter.post("/:recipientId",
  validateParams(userIdParamSchema),
  validateBody(sendDirectMessageSchema),
  directMessageController.sendDirectMessage,
);

//    Mark messages from a user as read
//    NOTE: /:userId/read before /:userId (GET) to avoid ambiguity on PATCH
directMessageRouter.patch("/:userId/read",
  validateParams(userIdParamSchema),
  directMessageController.markAsRead,
);

//    Get conversation between current user and another user (paginated)
directMessageRouter.get("/:userId",
  validateParams(userIdParamSchema),
  directMessageController.getConversation,
);

//    Delete entire conversation with a user
directMessageRouter.delete("/:userId",
  validateParams(userIdParamSchema),
  directMessageController.deleteConversation,
);

export { directMessageRouter };