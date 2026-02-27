import express from "express";
import { authenticated } from "../middlewares/auth.middleware.js";
import {
  validateBody,
  validateParams,
} from "../middlewares/validate.middleware.js";
import * as inviteController from "../controllers/invite.controller.js";
import {
  createInviteSchema,
  inviteCodeParamSchema,
  serverIdParamSchema,
} from "../validations/invite.validation.js";

const inviteRouter = express.Router();

//    Get invite details by code
inviteRouter.get(
  "/:code",
  validateParams(inviteCodeParamSchema),
  inviteController.getInvite,
);

inviteRouter.use(authenticated);

//    Join server using invite code
inviteRouter.post(
  "/:code/join",
  validateParams(inviteCodeParamSchema),
  inviteController.joinServerWithInvite,
);

//    Delete/Revoke an invite
inviteRouter.delete(
  "/:code",
  validateParams(inviteCodeParamSchema),
  inviteController.deleteInvite,
);

//    Clean up expired invites
inviteRouter.post("/cleanup", inviteController.cleanupExpiredInvites);

//    Create server invite
inviteRouter.post(
  "/servers/:serverId/invites",
  validateParams(serverIdParamSchema),
  validateBody(createInviteSchema),
  inviteController.createInvite,
);

//    Get all invites for a server
inviteRouter.get(
  "/servers/:serverId/invites",
  validateParams(serverIdParamSchema),
  inviteController.getServerInvites,
);

export { inviteRouter };
