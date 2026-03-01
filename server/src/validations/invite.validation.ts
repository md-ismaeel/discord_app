import { z } from "zod";

//  Create invite
export const createInviteSchema = z.object({
  maxUses: z
    .number()
    .int()
    .min(0, "Max uses must be 0 (unlimited) or a positive integer")
    .max(100, "Max uses cannot exceed 100")
    .optional()
    .default(0),
  expiresIn: z
    .number()
    .int()
    .min(0, "Expiration must be 0 (never expires) or a positive number of seconds")
    .max(604_800, "Expiration cannot exceed 7 days (604800 seconds)")
    .optional()
    .default(86_400), // 24 hours
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

//  Join server via invite
// FIX: uppercase transform added — invite codes are stored as uppercase in the
// model (uppercase: true on the schema) so comparison will fail if the client
// sends lowercase. Normalise here before it hits the controller.
export const joinServerSchema = z.object({
  inviteCode: z
    .string()
    .length(8, "Invite code must be exactly 8 characters")
    .regex(/^[A-Za-z0-9]+$/, "Invite code must be alphanumeric")
    .transform((s) => s.toUpperCase()),
});


//  Param schemas
export const inviteCodeParamSchema = z.object({
  code: z
    .string()
    .min(1, "Invite code is required")
    .transform((s) => s.toUpperCase()),
});

export type InviteCodeParam = z.infer<typeof inviteCodeParamSchema>;
export type JoinServerInput = z.infer<typeof joinServerSchema>;
