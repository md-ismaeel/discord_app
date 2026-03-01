import express from "express";
import { validateBody, validateParams, validateQuery } from "@/middlewares/validate.middleware";
import { updateProfileSchema, changePasswordSchema, updateUserStatusSchema } from "@/validations/auth.validation";
import * as userController from "@/controllers/user.controller";
import { authenticated } from "@/middlewares/auth.middleware";
import { uploadAvatar } from "@/middlewares/upload.middleware";
import { searchUsersSchema, userIdParamSchema } from "@/validations/common";

const userRouter = express.Router();

// ALL ROUTES REQUIRE AUTHENTICATION
userRouter.use(authenticated);

// Get current user profile
userRouter.get("/me", userController.getMe);

// Update current user profile (name, username, bio)
userRouter.patch("/me", validateBody(updateProfileSchema), userController.updateProfile);

// Delete current user account
userRouter.delete("/me", userController.deleteAccount);

/**
 * Upload user avatar
 * 
 * HOW THIS WORKS:
 * 1. uploadAvatar.single('avatar') is multer middleware
 * 2. It expects a file field named 'avatar' in the form data
 * 3. Multer receives the file, stores it in memory as a Buffer
 * 4. The Buffer is accessible via req.file.buffer in the controller
 * 5. Controller passes the buffer to Cloudinary service
 * 6. Cloudinary uploads and returns a URL
 * 
 * CLIENT SIDE (example):
 * const formData = new FormData();
 * formData.append('avatar', fileInputElement.files[0]);
 * await fetch('/api/users/me/avatar', { method: 'POST', body: formData });
 */
userRouter.post("/me/avatar",
  uploadAvatar.single("avatar"), // Multer middleware: receives file, stores in memory
  userController.uploadAvatar,   // Controller: gets req.file.buffer, uploads to Cloudinary
);

// Change user password
userRouter.patch("/me/password",
  validateBody(changePasswordSchema),
  userController.changePassword,
);

// Update user status (online/offline/away/dnd)
userRouter.patch("/me/status",
  validateBody(updateUserStatusSchema),
  userController.updateStatus,
);

// SERVER ROUTES

// Get all servers current user is a member of
userRouter.get("/me/servers", userController.getUserServers);

// FRIENDS ROUTES

// Get user's friends list
userRouter.get("/me/friends", userController.getFriends);

// Add a friend
userRouter.post("/me/friends/:userId",
  validateParams(userIdParamSchema),
  userController.addFriend,
);

// Remove a friend
userRouter.delete("/me/friends/:userId",
  validateParams(userIdParamSchema),
  userController.removeFriend,
);

// BLOCKING ROUTES

// Get list of blocked users
userRouter.get("/me/blocked", userController.getBlockedUsers);

// Block a user
userRouter.post("/me/blocked/:userId",
  validateParams(userIdParamSchema),
  userController.blockUser,
);

// Unblock a user
userRouter.delete("/me/blocked/:userId",
  validateParams(userIdParamSchema),
  userController.unblockUser,
);

// USER SEARCH & DISCOVERY ROUTES

// Search for users by username or email
userRouter.get("/search",
  validateQuery(searchUsersSchema),
  userController.searchUsers,
);

// Get user by ID
userRouter.get("/:id", validateParams(userIdParamSchema), userController.getUserById);

export { userRouter };