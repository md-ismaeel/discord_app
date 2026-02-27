import mongoose from "mongoose";

const serverSchema = new mongoose.Schema(
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
      maxlength: 500,
      default: "",
    },
    icon: {
      type: String,
      default: null,
    },
    banner: {
      type: String,
      default: null,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ServerMember",
      },
    ],
    channels: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Channel",
      },
    ],
    invites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Invite",
      },
    ],
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
serverSchema.index({ owner: 1 });
serverSchema.index({ name: 1 });
serverSchema.index({ members: 1 });

export const ServerModel = mongoose.model("Server", serverSchema);
