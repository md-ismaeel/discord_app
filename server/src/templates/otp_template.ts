//  Email templates
export const otpEmailTemplate = (otp: string, type: "email" | "phone"): string => {
    const label = type === "email" ? "email address" : "phone number";
    return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Verification Code</title>
    </head>
    <body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
        <tr>
          <td align="center">
            <table width="480" cellpadding="0" cellspacing="0"
              style="background:#1e1f22;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5865f2,#7289da);padding:32px;text-align:center;">
                  <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">🔐 Discord App</h1>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 32px;">
                  <p style="color:#b5bac1;margin:0 0 8px;font-size:15px;">
                    Use the code below to verify your <strong style="color:#fff;">${label}</strong>.
                    It expires in <strong style="color:#fff;">10 minutes</strong>.
                  </p>

                  <!-- OTP box -->
                  <div style="margin:28px 0;text-align:center;">
                    <span style="
                      display:inline-block;
                      background:#2b2d31;
                      border:2px solid #5865f2;
                      border-radius:10px;
                      padding:18px 40px;
                      font-size:38px;
                      font-weight:700;
                      letter-spacing:14px;
                      color:#5865f2;
                      font-family:'Courier New',monospace;
                    ">${otp}</span>
                  </div>

                  <p style="color:#b5bac1;margin:0;font-size:13px;line-height:1.6;">
                    If you didn't request this code, please ignore this email.
                    Your account is safe — no changes have been made.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background:#16171a;padding:20px 32px;text-align:center;">
                  <p style="color:#4e5058;margin:0;font-size:12px;">
                    © ${new Date().getFullYear()} Discord App. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
};