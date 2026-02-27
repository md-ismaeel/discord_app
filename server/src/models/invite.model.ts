import mongoose from "mongoose";

const inviteSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
    },
    server: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    inviter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    maxUses: {
      type: Number,
      default: null, // null = unlimited
    },
    uses: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      default: null, // null = never expires
    },
  },
  {
    timestamps: true,
  },
);

inviteSchema.index({ code: 1 });
inviteSchema.index({ server: 1 });
inviteSchema.index({ expiresAt: 1 });

export const InviteModel = mongoose.model("Invite", inviteSchema);
