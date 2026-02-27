import mongoose from "mongoose";

const channelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["text", "voice"],
      required: true,
    },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    category: {
      type: String,
      default: null,
    },
    position: {
      type: Number,
      default: 0,
    },
    topic: {
      type: String,
      default: "",
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    allowedRoles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
      },
    ],
  },
  {
    timestamps: true,
  },
);

channelSchema.index({ server: 1, position: 1 });
channelSchema.index({ server: 1, type: 1 });

export const ChannelModel = mongoose.model("Channel", channelSchema);
