import mongoose, { Schema, Model } from "mongoose";
import { IUser } from "../types/models";

const img = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function (this: IUser) {
        return this.provider === "email";
      },
      minlength: 6,
      select: false,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    avatar: {
      type: String,
      default: img,
    },
    avatarPublicId: {
      type: String,
      default: null,
    },
    avatarKey: {
      type: String,
      default: null,
    },
    provider: {
      type: String,
      enum: ["email", "google", "github", "facebook"],
      required: true,
    },
    providerId: {
      type: String,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["online", "offline", "away", "dnd"],
      default: "offline",
    },
    customStatus: {
      type: String,
      default: "",
      maxlength: 128,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 500,
    },
    friends: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    servers: [
      {
        type: Schema.Types.ObjectId,
        ref: "Server",
      },
    ],
    blockedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark", "auto"],
        default: "dark",
      },
      language: {
        type: String,
        default: "en",
      },
      notifications: {
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        directMessages: { type: Boolean, default: true },
      },
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ provider: 1, providerId: 1 });
userSchema.index({ status: 1 });

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  delete obj.avatarPublicId;
  delete obj.avatarKey;
  return obj;
};

// Virtual for display name
userSchema.virtual("displayName").get(function (this: IUser) {
  return this.username || this.name;
});

// Method to check if user is online
userSchema.methods.isOnline = function (this: IUser) {
  return this.status === "online";
};

export const UserModel: Model<IUser> = (mongoose.models.User as Model<IUser>) || mongoose.model<IUser>("User", userSchema);
