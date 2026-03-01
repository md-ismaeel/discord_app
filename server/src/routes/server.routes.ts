import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import { validateBody, validateParams } from "@/middlewares/validate.middleware";
import * as serverController from "@/controllers/server.controller";
import * as channelController from "@/controllers/channel.controller";
import * as inviteController from "@/controllers/invite.controller";
import * as roleController from "@/controllers/role.controller";
import {
  createServerSchema,
  updateServerSchema,
  serverIdParamSchema,
  serverMemberIdParamSchema,
} from "@/validations/server.validation";
import {
  createChannelSchema,
  updateChannelSchema,
  channelIdParamSchema,
  reorderChannelsSchema,
} from "@/validations/channel.validation";
import { updateMemberRoleSchema } from "@/validations/serverMember.validation";
import { createInviteSchema } from "@/validations/invite.validation";
import { createRoleSchema } from "@/validations/role.validation";

const serverRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
serverRouter.use(authenticated);

// SERVER MANAGEMENT

//    Create a new server
serverRouter.post("/",
  validateBody(createServerSchema),
  serverController.createServer,
);

//    Get all servers for current user
serverRouter.get("/", serverController.getUserServers);

//    Get server by ID
serverRouter.get("/:serverId",
  validateParams(serverIdParamSchema),
  serverController.getServer,
);

//    Update server
serverRouter.patch("/:serverId",
  validateParams(serverIdParamSchema),
  validateBody(updateServerSchema),
  serverController.updateServer,
);

//    Delete server
serverRouter.delete("/:serverId",
  validateParams(serverIdParamSchema),
  serverController.deleteServer,
);

//    Leave server
serverRouter.post("/:serverId/leave",
  validateParams(serverIdParamSchema),
  serverController.leaveServer,
);

// CHANNEL MANAGEMENT

//    Create a new channel
serverRouter.post("/:serverId/channels",
  validateParams(serverIdParamSchema),
  validateBody(createChannelSchema),
  channelController.createChannel,
);

//    Get all channels in a server
serverRouter.get("/:serverId/channels",
  validateParams(serverIdParamSchema),
  channelController.getServerChannels,
);

//    Reorder channels
serverRouter.patch("/:serverId/channels/reorder",
  validateParams(serverIdParamSchema),
  validateBody(reorderChannelsSchema),
  channelController.reorderChannels,
);

//    Get channel by ID
serverRouter.get("/channels/:channelId",
  validateParams(channelIdParamSchema),
  channelController.getChannel,
);

//    Update channel
serverRouter.patch("/channels/:channelId",
  validateParams(channelIdParamSchema),
  validateBody(updateChannelSchema),
  channelController.updateChannel,
);

//    Delete channel
serverRouter.delete("/channels/:channelId",
  validateParams(channelIdParamSchema),
  channelController.deleteChannel,
);

// MEMBER MANAGEMENT

//    Get all members of a server
serverRouter.get("/:serverId/members",
  validateParams(serverIdParamSchema),
  serverController.getServerMembers,
);

//    Update member role
serverRouter.patch("/:serverId/members/:memberId/role",
  validateParams(serverMemberIdParamSchema),
  validateBody(updateMemberRoleSchema),
  serverController.updateMemberRole,
);

//    Kick member from server
serverRouter.delete("/:serverId/members/:memberId",
  validateParams(serverMemberIdParamSchema),
  serverController.kickMember,
);


// INVITE MANAGEMENT

//    Create server invite
serverRouter.post("/:serverId/invites",
  validateParams(serverIdParamSchema),
  validateBody(createInviteSchema),
  inviteController.createInvite,
);

//    Get all invites for a server
serverRouter.get("/:serverId/invites",
  validateParams(serverIdParamSchema),
  inviteController.getServerInvites,
);

// ROLE MANAGEMENT

//    Create a new role
serverRouter.post("/:serverId/roles",
  validateParams(serverIdParamSchema),
  validateBody(createRoleSchema),
  roleController.createRole,
);

//    Get all roles in a server
serverRouter.get("/:serverId/roles",
  validateParams(serverIdParamSchema),
  roleController.getServerRoles,
);

export { serverRouter };