import mongoose, { Schema, type Model } from "mongoose";
import type { IServerMember } from "@/types/models";

const serverMemberSchema = new Schema<IServerMember>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Server is required"],
    },
    // Coarse hierarchy — for fast middleware gates (isAdmin, isModerator)
    role: {
      type: String,
      enum: {
        values: ["owner", "admin", "moderator", "member"] as const,
        message: "{VALUE} is not a valid member role",
      },
      default: "member",
    },
    // Fine-grained permission roles from the Role collection
    roles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    // Per-server display name — overrides user.name inside this server
    nickname: {
      type: String,
      default: null,
      trim: true,
      maxlength: [32, "Nickname cannot exceed 32 characters"],
    },
    // Voice moderation — managed by admins/moderators
    isMuted: { type: Boolean, default: false },
    isDeafened: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

//  Indexes 
// Primary constraint — a user can only be a member of each server once
serverMemberSchema.index({ user: 1, server: 1 }, { unique: true });
// List all members of a server filtered by hierarchy role
serverMemberSchema.index({ server: 1, role: 1 });
// Member list sorted by join date
serverMemberSchema.index({ server: 1, joinedAt: 1 });

//  Model 
export const ServerMemberModel: Model<IServerMember> = (mongoose.models["ServerMember"] as Model<IServerMember>) ?? mongoose.model<IServerMember>("ServerMember", serverMemberSchema);