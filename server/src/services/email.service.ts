import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import { getEnv } from "@/config/env.config";
import { otpEmailTemplate } from "@/templates/otp_template";

//  Transporter (created lazily so missing env vars don't crash at import)
let _transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: getEnv("SMTP_HOST"),
    port: parseInt(getEnv("SMTP_PORT"), 10),
    secure: parseInt(getEnv("SMTP_PORT"), 10) === 465, // true for port 465, false for 587
    auth: {
      user: getEnv("SMTP_USER"),
      pass: getEnv("SMTP_PASS"),
    },
  });

  return _transporter;
};

//  Public API

/**
 * Send an OTP verification email to the given address.
 * @param to  - Recipient email address
 * @param otp - Plain-text 6-digit OTP (will NOT be logged)
 */
export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  const mailOptions: SendMailOptions = {
    from: `"Discord App" <${getEnv("EMAIL_FROM")}>`,
    to,
    subject: `Your verification code: ${otp}`,
    text: `Your Discord App verification code is: ${otp}. It expires in 10 minutes.`,
    html: otpEmailTemplate(otp, "email"),
  };

  await getTransporter().sendMail(mailOptions);
};
