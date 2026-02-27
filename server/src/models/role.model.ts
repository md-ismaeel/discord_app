import mongoose, { Schema, type Model } from "mongoose";
import type { IRole, IRolePermissions } from "@/types/models";

// ─── Sub-schema ───────────────────────────────────────────────────────────────
// Explicit sub-schema for permissions so Mongoose validates each boolean field
// rather than accepting anything as a mixed object.

const permissionsSchema = new Schema<IRolePermissions>(
  {
    // Super-permission — implicitly grants all others
    administrator: { type: Boolean, default: false },
    manageServer: { type: Boolean, default: false },
    manageRoles: { type: Boolean, default: false },
    manageChannels: { type: Boolean, default: false },
    kickMembers: { type: Boolean, default: false },
    banMembers: { type: Boolean, default: false },
    // Enabled by default — members can invite friends
    createInvite: { type: Boolean, default: true },
    manageMessages: { type: Boolean, default: false },
    // Enabled by default for normal member usage
    sendMessages: { type: Boolean, default: true },
    readMessages: { type: Boolean, default: true },
    mentionEveryone: { type: Boolean, default: false },
    connect: { type: Boolean, default: true },
    speak: { type: Boolean, default: true },
    muteMembers: { type: Boolean, default: false },
    deafenMembers: { type: Boolean, default: false },
  },
  { _id: false },
);

// ─── Schema 

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: [true, "Role name is required"],
      trim: true,
      maxlength: [100, "Role name cannot exceed 100 characters"],
    },
    // Discord-style default grey. Validated as a 6-digit hex colour.
    color: {
      type: String,
      default: "#99AAB5",
      match: [/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex colour (e.g. #99AAB5)"],
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Role must belong to a server"],
    },
    permissions: {
      type: permissionsSchema,
      // () => ({}) triggers the sub-schema defaults for every field
      default: () => ({}),
    },
    position: {
      type: Number,
      default: 0,
      min: [0, "Position cannot be negative"],
    },
    // Only one role per server should have isDefault: true (@everyone)
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Fetch all roles for a server ordered by priority
roleSchema.index({ server: 1, position: 1 });
// Fast lookup for the @everyone / default role
roleSchema.index({ server: 1, isDefault: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const RoleModel: Model<IRole> =
  (mongoose.models["Role"] as Model<IRole>) ??
  mongoose.model<IRole>("Role", roleSchema);