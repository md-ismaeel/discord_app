import mongoose, { Schema, type Model } from "mongoose";
import type { IDirectMessage, IAttachment } from "@/types/models";

// ─── Sub-schema ───────────────────────────────────────────────────────────────

const attachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: [true, "Attachment URL is required"] },
    filename: {
      type: String,
      required: [true, "Attachment filename is required"],
    },
    size: { type: Number, required: [true, "Attachment size is required"] },
    type: { type: String, required: [true, "Attachment MIME type is required"] },
    // These fields were in IDirectMessage but missing from the original schema —
    // they would be silently stripped on every save.
    publicId: { type: String, default: null },
    key: { type: String, default: null },
  },
  { _id: false },
);

// ─── Schema ───────────────────────────────────────────────────────────────────

const directMessageSchema = new Schema<IDirectMessage>(
  {
    content: {
      type: String,
      required: [true, "Message content is required"],
      trim: true,
      maxlength: [4000, "Message cannot exceed 4000 characters"],
    },
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
    attachments: { type: [attachmentSchema], default: [] },
    isRead: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Fetch DM conversation between two users, newest-first
directMessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
// Unread message count for a user's inbox
directMessageSchema.index({ receiver: 1, isRead: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const DirectMessageModel: Model<IDirectMessage> =
  (mongoose.models["DirectMessage"] as Model<IDirectMessage>) ??
  mongoose.model<IDirectMessage>("DirectMessage", directMessageSchema);