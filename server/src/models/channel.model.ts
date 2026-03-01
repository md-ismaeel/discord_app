import mongoose, { Schema, type Model } from "mongoose";
import type { IChannel } from "@/types/models";

const channelSchema = new Schema<IChannel>(
  {
    name: {
      type: String,
      required: [true, "Channel name is required"],
      trim: true,
      minlength: [1, "Channel name cannot be empty"],
      maxlength: [100, "Channel name cannot exceed 100 characters"],
    },
    type: {
      type: String,
      enum: {
        values: ["text", "voice"] as const,
        message: "{VALUE} is not a valid channel type",
      },
      required: [true, "Channel type is required"],
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Channel must belong to a server"],
    },
    category: {
      type: String,
      default: null,
      trim: true,
    },
    position: {
      type: Number,
      default: 0,
      min: [0, "Position cannot be negative"],
    },
    topic: {
      type: String,
      default: "",
      maxlength: [1024, "Topic cannot exceed 1024 characters"],
      trim: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    allowedRoles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
  },
  { timestamps: true },
);

//  Indexes

// Fetch all channels for a server sorted by position
channelSchema.index({ server: 1, position: 1 });
// Filter by type within a server (e.g. voice channels only)
channelSchema.index({ server: 1, type: 1 });

//  Model

export const ChannelModel: Model<IChannel> = (mongoose.models["Channel"] as Model<IChannel>) ?? mongoose.model<IChannel>("Channel", channelSchema);