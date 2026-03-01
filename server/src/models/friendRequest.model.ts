import mongoose, { Schema, type Model } from "mongoose";
import type { IFriendRequest } from "@/types/models";

const friendRequestSchema = new Schema<IFriendRequest>(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender is required"],
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Receiver is required"],
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "accepted", "declined"] as const,
        message: "{VALUE} is not a valid friend request status",
      },
      default: "pending",
    },
  },
  { timestamps: true },
);

//  Indexes
friendRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true });
friendRequestSchema.index({ receiver: 1, status: 1 });

//  Model
export const FriendRequestModel: Model<IFriendRequest> = (mongoose.models["FriendRequest"] as Model<IFriendRequest>) ?? mongoose.model<IFriendRequest>("FriendRequest", friendRequestSchema);