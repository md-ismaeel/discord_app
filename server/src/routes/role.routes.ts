import express from "express";
import { authenticated } from "../middlewares/auth.middleware.js";
import {
  validateBody,
  validateParams,
} from "../middlewares/validate.middleware.js";
import * as roleController from "../controllers/role.controller.js";
import * as roleValidation from "../validations/role.validation.js";

const roleRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
roleRouter.use(authenticated);

//    Create a new role
roleRouter.post(
  "/servers/:serverId/roles",
  validateParams(roleValidation.serverIdParamSchema),
  validateBody(roleValidation.createRoleSchema),
  roleController.createRole,
);

//    Get all roles in a server
roleRouter.get(
  "/servers/:serverId/roles",
  validateParams(roleValidation.serverIdParamSchema),
  roleController.getServerRoles,
);

//    Reorder roles
roleRouter.patch(
  "/servers/:serverId/roles/reorder",
  validateParams(roleValidation.serverIdParamSchema),
  validateBody(roleValidation.reorderRolesSchema),
  roleController.reorderRoles,
);

//    Get a single role by ID
roleRouter.get(
  "/roles/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  roleController.getRole,
);

//    Update a role
roleRouter.patch(
  "/roles/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  validateBody(roleValidation.updateRoleSchema),
  roleController.updateRole,
);

//    Delete a role
roleRouter.delete(
  "/roles/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  roleController.deleteRole,
);

//    Assign role to a member
roleRouter.post(
  "/servers/:serverId/members/:memberId/roles/:roleId",
  validateParams(roleValidation.memberRoleParamSchema),
  roleController.assignRole,
);

//    Remove role from a member
roleRouter.delete(
  "/servers/:serverId/members/:memberId/roles/:roleId",
  validateParams(roleValidation.memberRoleParamSchema),
  roleController.removeRole,
);

export { roleRouter };
