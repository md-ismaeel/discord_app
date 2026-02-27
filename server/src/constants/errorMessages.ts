// common error messages
export const ERROR_MESSAGES = {
  // Auth
  UNAUTHORIZED:"Authentication required. Please log in to access this resource.",
  FORBIDDEN: "You do not have permission to access this resource",
  INVALID_CREDENTIALS: "Invalid email or password",
  TOKEN_EXPIRED: "Your session has expired. Please login again",

  // User
  USER_NOT_FOUND: "User not found",
  USER_ALREADY_EXISTS: "User with this email already exists",
  USERNAME_TAKEN: "Username is already taken",

  // Friend
  FRIEND_REQUEST_EXISTS: "Friend request already sent",
  FRIEND_REQUEST_NOT_FOUND: "Friend request not found",
  ALREADY_FRIENDS: "You are already friends with this user",
  CANNOT_ADD_SELF: "You cannot add yourself as a friend",

  // Server
  SERVER_NOT_FOUND: "Server not found",
  SERVER_NAME_REQUIRED: "Server name is required",
  NOT_SERVER_MEMBER: "You are not a member of this server",
  NOT_SERVER_OWNER: "Only the server owner can perform this action",
  SERVER_OWNER_NOT_LEAVE:
    "The server owner cannot leave the server without deleting it",

  // Channel
  CHANNEL_NOT_FOUND: "Channel not found",
  CHANNEL_NAME_REQUIRED: "Channel name is required",

  // Message
  MESSAGE_NOT_FOUND: "Message not found",
  MESSAGE_EMPTY: "Message cannot be empty",
  CANNOT_EDIT_MESSAGE: "You can only edit your own messages",
  CANNOT_DELETE_MESSAGE: "You can only delete your own messages",

  // Invite
  INVITE_NOT_FOUND: "Invite not found or expired",
  INVITE_EXPIRED: "This invite has expired",
  INVITE_MAX_USES: "This invite has reached its maximum uses",

  // General
  VALIDATION_ERROR: "Validation failed",
  INTERNAL_SERVER_ERROR: "Something went wrong. Please try again later",
  RESOURCE_NOT_FOUND: "Requested resource not found",
};
