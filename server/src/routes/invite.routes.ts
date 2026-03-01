import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import { validateParams } from "@/middlewares/validate.middleware";
import * as inviteController from "@/controllers/invite.controller";
import { inviteCodeParamSchema } from "@/validations/invite.validation";

const inviteRouter = express.Router();

//    Preview an invite by code (shown before the user decides to join)
inviteRouter.get("/:code",
  validateParams(inviteCodeParamSchema),
  inviteController.getInvite,
);

// ALL ROUTES BELOW REQUIRE AUTHENTICATION
inviteRouter.use(authenticated);

//    Clean up all expired invites (admin/cron task)
inviteRouter.post("/cleanup", inviteController.cleanupExpiredInvites);

//    Join a server using an invite code
inviteRouter.post("/:code/join",
  validateParams(inviteCodeParamSchema),
  inviteController.joinServerWithInvite,
);

//    Revoke / delete an invite
inviteRouter.delete("/:code",
  validateParams(inviteCodeParamSchema),
  inviteController.deleteInvite,
);

export { inviteRouter };