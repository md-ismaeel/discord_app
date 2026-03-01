import { Document, Types } from "mongoose";

// ─── Reusable sub-document interfaces ────────────────────────────────────────
// Define once, import everywhere — keeps schema types and model types in sync.

export interface IAttachment {
  url: string;
  filename: string;
  /** File size in bytes */
  size: number;
  /** MIME type, e.g. "image/png" */
  type: string;
  /** Cloudinary public_id */
  publicId?: string;
  /** AWS S3 object key */
  key?: string;
}

export interface IReaction {
  emoji: string;
  users: Types.ObjectId[];
}

export interface IBannedUser {
  user: Types.ObjectId;
  bannedBy: Types.ObjectId;
  reason?: string;
  bannedAt: Date;
}

export interface INotificationPreferences {
  email: boolean;
  push: boolean;
  mentions: boolean;
  directMessages: boolean;
}

export interface IUserPreferences {
  theme: "light" | "dark" | "auto";
  language: string;
  notifications: INotificationPreferences;
}

// ─── Instance method interfaces ───────────────────────────────────────────────
// Separating methods from the document shape lets .lean() callers use the
// plain IUser shape without the method signatures polluting the type.

export interface IUserMethods {
  isOnline(): boolean;
}

export interface IRolePermissions {
  administrator: boolean;
  manageServer: boolean;
  manageRoles: boolean;
  manageChannels: boolean;
  kickMembers: boolean;
  banMembers: boolean;
  createInvite: boolean;
  manageMessages: boolean;
  sendMessages: boolean;
  readMessages: boolean;
  mentionEveryone: boolean;
  connect: boolean;
  speak: boolean;
  muteMembers: boolean;
  deafenMembers: boolean;
}

// ─── Document interfaces ──────────────────────────────────────────────────────

export interface IUser extends Document, IUserMethods {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** Only for email/password accounts — select: false in schema */
  password?: string;
  /** Unique handle for @mentions. Sparse — OAuth users may omit it. */
  username?: string;
  avatar: string;
  /** Cloudinary public_id — stripped from toJSON */
  avatarPublicId?: string;
  /** S3 key — stripped from toJSON */
  avatarKey?: string;
  provider: "email" | "google" | "github" | "facebook";
  providerId?: string;
  status: "online" | "offline" | "away" | "dnd";
  customStatus: string;
  bio: string;
  friends: Types.ObjectId[];
  servers: Types.ObjectId[];
  blockedUsers: Types.ObjectId[];
  lastSeen: Date;
  isEmailVerified: boolean;
  /** Always present — schema provides defaults for all sub-fields */
  preferences: IUserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface IServer extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  icon?: string;
  iconPublicId?: string;
  iconKey?: string;
  banner?: string;
  bannerPublicId?: string;
  bannerKey?: string;
  owner: Types.ObjectId;
  members: Types.ObjectId[];
  channels: Types.ObjectId[];
  invites: Types.ObjectId[];
  bannedUsers: IBannedUser[];
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannel extends Document {
  _id: Types.ObjectId;
  name: string;
  type: "text" | "voice";
  server: Types.ObjectId;
  category?: string;
  position: number;
  topic: string;
  isPrivate: boolean;
  allowedRoles: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  content: string;
  author: Types.ObjectId;
  channel: Types.ObjectId;
  server: Types.ObjectId;
  attachments: IAttachment[];
  mentions: Types.ObjectId[];
  replyTo?: Types.ObjectId;
  isPinned: boolean;
  isEdited: boolean;
  editedAt?: Date;
  reactions: IReaction[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectMessage extends Document {
  _id: Types.ObjectId;
  content: string;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  attachments: IAttachment[];
  isRead: boolean;
  isEdited: boolean;
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFriendRequest extends Document {
  _id: Types.ObjectId;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  status: "pending" | "accepted" | "declined";
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvite extends Document {
  _id: Types.ObjectId;
  code: string;
  server: Types.ObjectId;
  inviter: Types.ObjectId;
  /** null = unlimited uses */
  maxUses?: number;
  uses: number;
  /** null = never expires */
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRole extends Document {
  _id: Types.ObjectId;
  name: string;
  /** Hex colour string e.g. "#99AAB5" */
  color: string;
  server: Types.ObjectId;
  permissions: IRolePermissions;
  /** Display/priority order — higher = more powerful */
  position: number;
  /** True for the auto-assigned @everyone equivalent */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IServerMember extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  server: Types.ObjectId;
  /** Coarse hierarchy — for simple middleware gates */
  role: "owner" | "admin" | "moderator" | "member";
  /** Fine-grained permission roles from the Role collection */
  roles: Types.ObjectId[];
  /** Per-server display name override */
  nickname?: string;
  /** Server-muted by a moderator (cannot speak) */
  isMuted: boolean;
  /** Server-deafened by a moderator (cannot hear) */
  isDeafened: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}