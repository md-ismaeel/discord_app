import mongoose from "mongoose";

const serverMemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    // Basic hierarchy role
    role: {
      type: String,
      enum: ["owner", "admin", "moderator", "member"],
      default: "member",
    },
    // Permission-based roles (links to Role model)
    roles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
      },
    ],
    // Server nickname (overrides display name inside this server)
    nickname: {
      type: String,
      default: null,
      maxlength: 32,
      trim: true,
    },
    // Voice moderation states
    isMuted: {
      type: Boolean,
      default: false, // Server-muted (cannot speak)
    },
    isDeafened: {
      type: Boolean,
      default: false, // Server-deafened (cannot hear)
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
serverMemberSchema.index({ user: 1, server: 1 }, { unique: true });
serverMemberSchema.index({ server: 1, role: 1 });
serverMemberSchema.index({ server: 1, joinedAt: 1 });

export const ServerMemberModel = mongoose.model(
  "ServerMember",
  serverMemberSchema,
);
