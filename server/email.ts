import nodemailer from "nodemailer";

// ─── SMTP Transport ───────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.office365.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
  tls: {
    ciphers: "SSLv3",
    rejectUnauthorized: false,
  },
});

const FROM = process.env.SMTP_FROM || "Stock Otter <superotter@stockotter.ai>";
const APP_URL = process.env.APP_URL || "https://stockotter.ai";

// ─── Branded Email Template ───────────────────────────────────────────────────

function emailWrapper(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#040d22; font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#040d22; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#0c1225; border-radius:12px; border:1px solid #1E2235; overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding:24px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:24px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">STOCK</span>
                    <span style="font-size:24px; font-weight:800; color:rgba(255,255,255,0.85); letter-spacing:-0.5px;"> OTTER</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px; border-top:1px solid #1E2235;">
              <p style="margin:0; font-size:12px; color:#4B5E80; line-height:1.5;">
                Stock Otter — Smart Trading Analysis<br>
                <a href="${APP_URL}" style="color:#6366F1; text-decoration:none;">${APP_URL.replace('https://', '')}</a>
              </p>
              <p style="margin:8px 0 0; font-size:10px; color:#3B4560; line-height:1.4;">
                Stock Otter is not a financial advisor. All data is provided for informational purposes only.
                Do not trade based solely on this information.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function passwordResetEmail(resetUrl: string, displayName: string | null): string {
  const name = displayName || "there";
  return emailWrapper("Reset Your Password", `
    <h2 style="margin:0 0 8px; font-size:20px; font-weight:700; color:#E2E8F0;">Reset Your Password</h2>
    <p style="margin:0 0 20px; font-size:14px; color:#94A3B8; line-height:1.6;">
      Hey ${name}, we received a request to reset your Stock Otter password. Click the button below to choose a new one.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:linear-gradient(135deg,#6366F1,#8B5CF6); border-radius:8px; padding:12px 28px;">
          <a href="${resetUrl}" style="color:#ffffff; text-decoration:none; font-size:14px; font-weight:700; display:inline-block;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px; font-size:12px; color:#64748B; line-height:1.5;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px; font-size:12px; color:#6366F1; word-break:break-all;">
      <a href="${resetUrl}" style="color:#6366F1;">${resetUrl}</a>
    </p>
    <p style="margin:0; font-size:12px; color:#475569; line-height:1.5;">
      This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
  `);
}

function welcomeEmail(displayName: string | null): string {
  const name = displayName || "there";
  return emailWrapper("Welcome to Stock Otter", `
    <h2 style="margin:0 0 8px; font-size:20px; font-weight:700; color:#E2E8F0;">Welcome to Stock Otter! 🦦</h2>
    <p style="margin:0 0 20px; font-size:14px; color:#94A3B8; line-height:1.6;">
      Hey ${name}, your account is all set. You now have access to the full trading analysis platform.
    </p>
    <p style="margin:0 0 16px; font-size:14px; font-weight:600; color:#E2E8F0;">Here's what you can do:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="padding:6px 0; font-size:13px; color:#94A3B8;">
        <span style="color:#10B981; font-weight:700;">✓</span>&nbsp; Analyze any stock with our 8-category scoring system
      </td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#94A3B8;">
        <span style="color:#10B981; font-weight:700;">✓</span>&nbsp; Get unified verdict scores (0-100) with buy/hold/avoid signals
      </td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#94A3B8;">
        <span style="color:#10B981; font-weight:700;">✓</span>&nbsp; Track institutional money flow and insider transactions
      </td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#94A3B8;">
        <span style="color:#10B981; font-weight:700;">✓</span>&nbsp; Use options calculators: payoff diagrams, Greeks, Kelly Criterion
      </td></tr>
      <tr><td style="padding:6px 0; font-size:13px; color:#94A3B8;">
        <span style="color:#10B981; font-weight:700;">✓</span>&nbsp; Log trades and track your performance over time
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:linear-gradient(135deg,#6366F1,#8B5CF6); border-radius:8px; padding:12px 28px;">
          <a href="${APP_URL}" style="color:#ffffff; text-decoration:none; font-size:14px; font-weight:700; display:inline-block;">
            Open Stock Otter
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0; font-size:13px; color:#94A3B8; line-height:1.6;">
      Start by searching a ticker symbol — try <strong style="color:#E2E8F0;">AAPL</strong>, <strong style="color:#E2E8F0;">TSLA</strong>, or <strong style="color:#E2E8F0;">HD</strong> to see the full analysis in action.
    </p>
  `);
}

// ─── Send Functions ───────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(to: string, token: string, displayName: string | null): Promise<boolean> {
  const resetUrl = `${APP_URL}/#/reset-password?token=${token}`;
  try {
    await transporter.sendMail({
      from: FROM,
      to,
      subject: "Reset Your Stock Otter Password",
      html: passwordResetEmail(resetUrl, displayName),
    });
    console.log(`[EMAIL] Password reset sent to ${to}`);
    return true;
  } catch (error: any) {
    console.error(`[EMAIL] Failed to send password reset to ${to}:`, error?.message || error);
    return false;
  }
}

export async function sendWelcomeEmail(to: string, displayName: string | null): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: FROM,
      to,
      subject: "Welcome to Stock Otter — Let's Trade Smarter",
      html: welcomeEmail(displayName),
    });
    console.log(`[EMAIL] Welcome email sent to ${to}`);
    return true;
  } catch (error: any) {
    console.error(`[EMAIL] Failed to send welcome email to ${to}:`, error?.message || error);
    return false;
  }
}

// ─── Verify SMTP Connection ───────────────────────────────────────────────────

export async function verifyEmailConnection(): Promise<boolean> {
  try {
    await transporter.verify();
    console.log("[EMAIL] SMTP connection verified — ready to send");
    return true;
  } catch (error: any) {
    console.error("[EMAIL] SMTP connection failed:", error?.message || error);
    return false;
  }
}
