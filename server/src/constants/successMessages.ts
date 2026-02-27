
export const SUCCESS_MESSAGES = {
    // ── Auth ──────────────────────────────────────────────────────────────────
    LOGIN_SUCCESS: "Logged in successfully.",
    LOGOUT_SUCCESS: "Logged out successfully.",
    REGISTER_SUCCESS: "Account created successfully.",
    AUTH_STATUS_SUCCESS: "User details fetched successfully.",

    // ── User ──────────────────────────────────────────────────────────────────
    USER_CREATED: "User created successfully.",
    USER_UPDATED: "User updated successfully.",
    USER_DELETED: "User deleted successfully.",
    PROFILE_UPDATED: "Profile updated successfully.",
    GET_PROFILE_SUCCESS: "Profile fetched successfully.",

    // ── Friends ───────────────────────────────────────────────────────────────
    FRIEND_REQUEST_SENT: "Friend request sent successfully.",
    FRIEND_REQUEST_ACCEPTED: "Friend request accepted.",
    FRIEND_REQUEST_DECLINED: "Friend request declined.",
    FRIEND_REMOVED: "Friend removed successfully.",
    GET_FRIENDS_SUCCESS: "Friends list fetched successfully.",

    // ── Server ────────────────────────────────────────────────────────────────
    SERVER_CREATED: "Server created successfully.",
    SERVER_UPDATED: "Server updated successfully.",
    SERVER_DELETED: "Server deleted successfully.",
    SERVER_JOINED: "Joined server successfully.",
    SERVER_LEFT: "Left server successfully.",
    GET_SERVERS_SUCCESS: "Servers fetched successfully.",
    GET_SERVER_MEMBERS_SUCCESS: "Server members fetched successfully.",

    // ── Channel ───────────────────────────────────────────────────────────────
    CHANNEL_CREATED: "Channel created successfully.",
    CHANNEL_UPDATED: "Channel updated successfully.",
    CHANNEL_DELETED: "Channel deleted successfully.",
    // Fixed typo: was "Channel fetched" (singular) — channels are fetched as a list
    CHANNELS_FETCHED: "Channels fetched successfully.",

    // ── Messages ──────────────────────────────────────────────────────────────
    MESSAGE_SENT: "Message sent successfully.",
    MESSAGE_UPDATED: "Message updated successfully.",
    MESSAGE_DELETED: "Message deleted successfully.",
    MESSAGES_FETCHED: "Messages fetched successfully.",

    // ── Invites ───────────────────────────────────────────────────────────────
    INVITE_CREATED: "Invite created successfully.",
    INVITE_DELETED: "Invite deleted successfully.",
} as const;

export type SuccessMessage = (typeof SUCCESS_MESSAGES)[keyof typeof SUCCESS_MESSAGES];