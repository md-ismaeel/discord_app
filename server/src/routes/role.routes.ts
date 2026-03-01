import express from "express";
import { authenticated } from "@/middlewares/auth.middleware";
import { validateBody, validateParams } from "@/middlewares/validate.middleware";
import * as roleController from "@/controllers/role.controller";
import * as roleValidation from "@/validations/role.validation";

const roleRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
roleRouter.use(authenticated);

//    Reorder roles in a server
roleRouter.patch("/servers/:serverId/roles/reorder",
  validateParams(roleValidation.serverIdParamSchema),
  validateBody(roleValidation.reorderRolesSchema),
  roleController.reorderRoles,
);

//    Assign role to a member
roleRouter.post("/servers/:serverId/members/:memberId/roles/:roleId",
  validateParams(roleValidation.memberRoleParamSchema),
  roleController.assignRole,
);

//    Remove role from a member
roleRouter.delete("/servers/:serverId/members/:memberId/roles/:roleId",
  validateParams(roleValidation.memberRoleParamSchema),
  roleController.removeRole,
);

//    Get a single role by ID
roleRouter.get("/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  roleController.getRole,
);

//    Update a role
roleRouter.patch("/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  validateBody(roleValidation.updateRoleSchema),
  roleController.updateRole,
);

//    Delete a role
roleRouter.delete("/:roleId",
  validateParams(roleValidation.roleIdParamSchema),
  roleController.deleteRole,
);

export { roleRouter };