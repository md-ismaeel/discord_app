import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      default: "#99AAB5",
    },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    permissions: {
      administrator: { type: Boolean, default: false },
      manageServer: { type: Boolean, default: false },
      manageRoles: { type: Boolean, default: false },
      manageChannels: { type: Boolean, default: false },
      kickMembers: { type: Boolean, default: false },
      banMembers: { type: Boolean, default: false },
      createInvite: { type: Boolean, default: true },
      manageMessages: { type: Boolean, default: false },
      sendMessages: { type: Boolean, default: true },
      readMessages: { type: Boolean, default: true },
      mentionEveryone: { type: Boolean, default: false },
      connect: { type: Boolean, default: true },
      speak: { type: Boolean, default: true },
      muteMembers: { type: Boolean, default: false },
      deafenMembers: { type: Boolean, default: false },
    },
    position: {
      type: Number,
      default: 0,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

roleSchema.index({ server: 1, position: 1 });

export const RoleModel = mongoose.model("Role", roleSchema);
