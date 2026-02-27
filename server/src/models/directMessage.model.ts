import mongoose from "mongoose";

const directMessageSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    attachments: [
      {
        url: String,
        filename: String,
        size: Number,
        type: String,
      },
    ],
    isRead: {
      type: Boolean,
      default: false,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

directMessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
directMessageSchema.index({ receiver: 1, isRead: 1 });

export const DirectMessageModel = mongoose.model(
  "DirectMessage",
  directMessageSchema,
);
