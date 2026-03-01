import { z } from "zod";
import { objectIdSchema } from "./common.js";

// Send friend request
export const sendFriendRequestSchema = z.object({
    receiverId: objectIdSchema.describe("User ID of the person to add as a friend"),
});

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

// Respond to friend request
export const respondFriendRequestSchema = z.object({
    action: z.enum(["accept", "decline"], {
        error: "Action must be 'accept' or 'decline'",
    }),
});

export type RespondFriendRequestInput = z.infer<typeof respondFriendRequestSchema>;

//  Param schemas
export const friendRequestIdParamSchema = z.object({
    requestId: objectIdSchema.describe("MongoDB ObjectId of the friend request"),
});

export type FriendRequestIdParam = z.infer<typeof friendRequestIdParamSchema>;