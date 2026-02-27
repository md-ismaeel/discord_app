import { Document, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  username?: string;
  avatar: string;
  avatarPublicId?: string;
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
  preferences?: {
    theme: "light" | "dark" | "auto";
    language: string;
    notifications: {
      email: boolean;
      push: boolean;
      mentions: boolean;
      directMessages: boolean;
    };
  };
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
  bannedUsers: Array<{
    user: Types.ObjectId;
    bannedBy: Types.ObjectId;
    reason?: string;
    bannedAt: Date;
  }>;
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
  attachments: Array<{
    url: string;
    filename: string;
    size: number;
    type: string;
    publicId?: string;
    key?: string;
  }>;
  mentions: Types.ObjectId[];
  replyTo?: Types.ObjectId;
  isPinned: boolean;
  isEdited: boolean;
  editedAt?: Date;
  reactions: Array<{
    emoji: string;
    users: Types.ObjectId[];
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectMessage extends Document {
  _id: Types.ObjectId;
  content: string;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  attachments: Array<{
    url: string;
    filename: string;
    size: number;
    type: string;
    publicId?: string;
    key?: string;
  }>;
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
  maxUses?: number;
  uses: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRole extends Document {
  _id: Types.ObjectId;
  name: string;
  color: string;
  server: Types.ObjectId;
  permissions: {
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
  };
  position: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IServerMember extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  server: Types.ObjectId;
  role: "owner" | "admin" | "moderator" | "member";
  roles: Types.ObjectId[];
  nickname?: string;
  isMuted: boolean;
  isDeafened: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
