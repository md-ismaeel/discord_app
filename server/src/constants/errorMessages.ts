// All user-facing error messages in one place.
// Using `as const` means ERROR_MESSAGES.USER_NOT_FOUND has the literal type
// "User not found" rather than `string`, which helps if you ever want to
// pattern-match on message values in tests or error handlers.

export const ERROR_MESSAGES = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  UNAUTHORIZED: "Authentication required. Please log in to access this resource.",
  FORBIDDEN: "You do not have permission to access this resource.",
  INVALID_CREDENTIALS: "Invalid email or password.",
  TOKEN_EXPIRED: "Your session has expired. Please log in again.",

  // ── User ──────────────────────────────────────────────────────────────────
  USER_NOT_FOUND: "User not found.",
  USER_ALREADY_EXISTS: "A user with this email already exists.",
  USERNAME_TAKEN: "That username is already taken.",

  // ── Friends ───────────────────────────────────────────────────────────────
  FRIEND_REQUEST_EXISTS: "A friend request has already been sent to this user.",
  FRIEND_REQUEST_NOT_FOUND: "Friend request not found.",
  ALREADY_FRIENDS: "You are already friends with this user.",
  CANNOT_ADD_SELF: "You cannot send a friend request to yourself.",

  // ── Server ────────────────────────────────────────────────────────────────
  SERVER_NOT_FOUND: "Server not found.",
  SERVER_NAME_REQUIRED: "Server name is required.",
  NOT_SERVER_MEMBER: "You are not a member of this server.",
  NOT_SERVER_OWNER: "Only the server owner can perform this action.",
  SERVER_OWNER_CANNOT_LEAVE:
    "The server owner cannot leave without first transferring ownership or deleting the server.",

  // ── Channel ───────────────────────────────────────────────────────────────
  CHANNEL_NOT_FOUND: "Channel not found.",
  CHANNEL_NAME_REQUIRED: "Channel name is required.",
  NOT_CHANNEL_MEMBER: "You are not a member of this channel.",

  // ── Messages ──────────────────────────────────────────────────────────────
  MESSAGE_NOT_FOUND: "Message not found.",
  MESSAGE_EMPTY: "Message cannot be empty.",
  CANNOT_EDIT_MESSAGE: "You can only edit your own messages.",
  CANNOT_DELETE_MESSAGE: "You can only delete your own messages.",

  // ── Invites ───────────────────────────────────────────────────────────────
  INVITE_NOT_FOUND: "Invite not found or has expired.",
  INVITE_EXPIRED: "This invite link has expired.",
  INVITE_MAX_USES: "This invite link has reached its maximum number of uses.",

  // ── General ───────────────────────────────────────────────────────────────
  VALIDATION_ERROR: "Validation failed. Please check your input.",
  INTERNAL_SERVER_ERROR: "Something went wrong. Please try again later.",
  RESOURCE_NOT_FOUND: "The requested resource was not found.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Please slow down and try again.",
} as const;

export type ErrorMessage = (typeof ERROR_MESSAGES)[keyof typeof ERROR_MESSAGES];