import mongoose, { Schema, type Model } from "mongoose";
import type { IMessage, IAttachment, IReaction } from "@/types/models";

//  Sub-schemas 
const attachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: [true, "Attachment URL is required"] },
    filename: {
      type: String,
      required: [true, "Attachment filename is required"],
    },
    size: { type: Number, required: [true, "Attachment size is required"] },
    type: { type: String, required: [true, "Attachment MIME type is required"] },
    publicId: { type: String, default: null },
    key: { type: String, default: null },
  },
  { _id: false },
);

const reactionSchema = new Schema<IReaction>(
  {
    emoji: { type: String, required: [true, "Emoji is required"] },
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { _id: false },
);

//  Schema
const messageSchema = new Schema<IMessage>(
  {
    content: {
      type: String,
      required: [true, "Message content is required"],
      trim: true,
      maxlength: [4000, "Message cannot exceed 4000 characters"],
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Message author is required"],
    },
    channel: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: [true, "Message must belong to a channel"],
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Message must belong to a server"],
    },
    attachments: { type: [attachmentSchema], default: [] },
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    isPinned: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    reactions: { type: [reactionSchema], default: [] },
  },
  { timestamps: true },
);

//  Indexes
messageSchema.index({ channel: 1, createdAt: -1 });
messageSchema.index({ server: 1, createdAt: -1 });
messageSchema.index({ author: 1 });
messageSchema.index({ channel: 1, isPinned: 1 });

//  Model
export const MessageModel: Model<IMessage> = (mongoose.models["Message"] as Model<IMessage>) ?? mongoose.model<IMessage>("Message", messageSchema);