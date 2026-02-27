import mongoose, { Schema, type Model } from "mongoose";
import type { IInvite } from "../types/models.js";

const inviteSchema = new Schema<IInvite>(
  {
    code: {
      type: String,
      required: [true, "Invite code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Invite must be linked to a server"],
    },
    inviter: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Invite must have an inviter"],
    },
    maxUses: {
      type: Number,
      default: null, // null = unlimited
      min: [1, "maxUses must be at least 1 if set"],
    },
    uses: {
      type: Number,
      default: 0,
      min: [0, "Uses cannot be negative"],
    },
    expiresAt: {
      type: Date,
      default: null, // null = never expires
    },
  },
  { timestamps: true },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Primary lookup path — join via invite code
inviteSchema.index({ code: 1 });
// All invites for a server
inviteSchema.index({ server: 1 });
// TTL-style queries — find / purge expired invites in background jobs
inviteSchema.index({ expiresAt: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const InviteModel: Model<IInvite> =
  (mongoose.models["Invite"] as Model<IInvite>) ??
  mongoose.model<IInvite>("Invite", inviteSchema);