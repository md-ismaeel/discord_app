import mongoose, { Schema, type Model } from "mongoose";
import type { IServer, IBannedUser } from "@/types/models";

// ─── Sub-schema
// A proper Schema for IBannedUser so Mongoose validates individual fields
// rather than treating the array element as a mixed type.

const bannedUserSchema = new Schema<IBannedUser>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Banned user ID is required"],
    },
    bannedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "bannedBy user ID is required"],
    },
    reason: { type: String, default: "", trim: true },
    bannedAt: { type: Date, default: Date.now },
  },
  // _id: false — sub-documents don't need their own ID here
  { _id: false },
);

// ─── Schema
const serverSchema = new Schema<IServer>(
  {
    name: {
      type: String,
      required: [true, "Server name is required"],
      trim: true,
      minlength: [2, "Server name must be at least 2 characters"],
      maxlength: [100, "Server name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
      default: "",
      trim: true,
    },
    icon: { type: String, default: null },
    iconPublicId: { type: String, default: null },
    iconKey: { type: String, default: null },
    banner: { type: String, default: null },
    bannerPublicId: { type: String, default: null },
    bannerKey: { type: String, default: null },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Server must have an owner"],
    },
    members: [{ type: Schema.Types.ObjectId, ref: "ServerMember" }],
    channels: [{ type: Schema.Types.ObjectId, ref: "Channel" }],
    invites: [{ type: Schema.Types.ObjectId, ref: "Invite" }],
    // bannedUsers was in IServer but MISSING from the original schema —
    // every ban would be silently discarded on save.
    bannedUsers: { type: [bannedUserSchema], default: [] },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── Indexes
serverSchema.index({ owner: 1 });
serverSchema.index({ name: 1 });
serverSchema.index({ members: 1 });
// Public server discovery — browse / search
serverSchema.index({ isPublic: 1, name: 1 });

// ─── Model 
export const ServerModel: Model<IServer> = (mongoose.models["Server"] as Model<IServer>) ??
  mongoose.model<IServer>("Server", serverSchema);