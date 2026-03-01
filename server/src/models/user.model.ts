import mongoose, { Schema, type Model, type HydratedDocument } from "mongoose";
import type { IUser, IUserMethods, IUserPreferences } from "@/types/models";

//  Types
// Pass all three generics so Mongoose knows the document shape, query helpers,
// AND instance methods. Without IUserMethods, calling doc.isOnline() errors.
type UserModelType = Model<IUser, Record<string, never>, IUserMethods>;
export type UserDocument = HydratedDocument<IUser, IUserMethods>;

//  Constants
const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

const DEFAULT_PREFERENCES: IUserPreferences = {
  theme: "dark",
  language: "en",
  notifications: {
    email: true,
    push: true,
    mentions: true,
    directMessages: true,
  },
};

//  Schema
const userSchema = new Schema<IUser, UserModelType, IUserMethods>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      // Only required for local email/password accounts
      required: function (this: IUser): boolean {
        return this.provider === "email";
      },
      minlength: [6, "Password must be at least 6 characters"],
      // Never returned in query results unless explicitly .select("+password")
      select: false,
    },
    username: {
      type: String,
      unique: true,
      // sparse: allows multiple documents with no username (OAuth users)
      sparse: true,
      trim: true,
      minlength: [2, "Username must be at least 2 characters"],
      maxlength: [32, "Username cannot exceed 32 characters"],
    },
    avatar: {
      type: String,
      default: DEFAULT_AVATAR,
    },
    // Storage metadata — stripped from toJSON so they never reach clients
    avatarPublicId: { type: String, default: null },
    avatarKey: { type: String, default: null },
    provider: {
      type: String,
      enum: {
        values: ["email", "google", "github", "facebook"] as const,
        message: "{VALUE} is not a supported provider",
      },
      required: [true, "Auth provider is required"],
    },
    providerId: {
      type: String,
      sparse: true,
    },
    status: {
      type: String,
      enum: {
        values: ["online", "offline", "away", "dnd"] as const,
        message: "{VALUE} is not a valid status",
      },
      default: "offline",
    },
    customStatus: {
      type: String,
      default: "",
      maxlength: [128, "Custom status cannot exceed 128 characters"],
      trim: true,
    },
    bio: {
      type: String,
      default: "",
      maxlength: [500, "Bio cannot exceed 500 characters"],
      trim: true,
    },
    friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
    servers: [{ type: Schema.Types.ObjectId, ref: "Server" }],
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    preferences: {
      type: {
        theme: {
          type: String,
          enum: {
            values: ["light", "dark", "auto"] as const,
            message: "{VALUE} is not a valid theme",
          },
          default: "dark",
        },
        language: { type: String, default: "en" },
        notifications: {
          email: { type: Boolean, default: true },
          push: { type: Boolean, default: true },
          mentions: { type: Boolean, default: true },
          directMessages: { type: Boolean, default: true },
        },
      },
      default: () => ({ ...DEFAULT_PREFERENCES }),
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ─── Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ provider: 1, providerId: 1 });
userSchema.index({ status: 1 });

//  Virtuals
userSchema.virtual("displayName").get(function (this: IUser): string {
  return this.username ?? this.name;
});

//  Instance methods
userSchema.methods.isOnline = function (this: IUser): boolean {
  return this.status === "online";
};

//  toJSON transform
// Strips internal/sensitive fields automatically on res.json() calls.
userSchema.set("toJSON", {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform(_doc, ret: any) {
    delete ret["password"];
    delete ret["__v"];
    delete ret["avatarPublicId"];
    delete ret["avatarKey"];
    return ret;
  },
});

//  Model
// Guard against model re-registration during hot-reload (ts-node --watch, Jest).
export const UserModel: UserModelType = (mongoose.models["User"] as UserModelType) ?? mongoose.model<IUser, UserModelType>("User", userSchema);