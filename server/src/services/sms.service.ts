import twilio from "twilio";
import { getEnv } from "@/config/env.config";

//  Client (created lazily)

let _client: ReturnType<typeof twilio> | null = null;

const getClient = (): ReturnType<typeof twilio> => {
    if (_client) return _client;

    const accountSid = getEnv("TWILIO_ACCOUNT_SID");
    const authToken = getEnv("TWILIO_AUTH_TOKEN");

    if (!accountSid || !authToken) {
        throw new Error(
            "Twilio credentials are not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
        );
    }

    _client = twilio(accountSid, authToken);
    return _client;
};

//  Public API

/**
 * Send an OTP verification SMS to the given phone number.
 * @param to  - E.164 phone number, e.g. "+919876543210"
 * @param otp - Plain-text 6-digit OTP
 */
export const sendOtpSms = async (to: string, otp: string): Promise<void> => {
    const from = getEnv("TWILIO_PHONE_NUMBER");

    if (!from) {
        throw new Error(
            "TWILIO_PHONE_NUMBER is not configured.",
        );
    }

    await getClient().messages.create({
        to,
        from,
        body: `Your Discord App verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
    });
};
