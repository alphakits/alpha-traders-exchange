import nodemailer from "nodemailer";
import { getSiteUrl } from "@/lib/site-url";

function getMailConfig() {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const from = process.env.SMTP_FROM ?? "";
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return { host, port, user, pass, from, secure };
}

function buildVerificationEmailHtml(input: { fullName: string; verifyUrl: string; expiresInHours: number }) {
  const escapedName = input.fullName.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#050505;color:#F9FAFB;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#0B0B0B;border:1px solid rgba(201,162,39,0.25);border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;border-bottom:1px solid rgba(201,162,39,0.25);">
                <div style="color:#C9A227;font-size:12px;letter-spacing:.14em;text-transform:uppercase;">Alpha Traders</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">Verify your email</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 12px;color:#D1D5DB;font-size:15px;line-height:1.7;">Hi ${escapedName || "Trader"}, your account was created successfully. Verify your email to activate your Alpha Traders account.</p>
                <p style="margin:0 0 22px;color:#D1D5DB;font-size:15px;line-height:1.7;">This verification link expires in ${input.expiresInHours} hours.</p>
                <p style="margin:0 0 22px;">
                  <a href="${input.verifyUrl}" style="display:inline-block;background:linear-gradient(180deg,#D4AF37,#C9A227);color:#050505;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;">Verify Email</a>
                </p>
                <p style="margin:0 0 8px;color:#9CA3AF;font-size:13px;line-height:1.6;">If the button doesn't work, use this link:</p>
                <p style="margin:0 0 18px;word-break:break-all;"><a href="${input.verifyUrl}" style="color:#C9A227;font-size:13px;">${input.verifyUrl}</a></p>
                <p style="margin:0;color:#9CA3AF;font-size:12px;line-height:1.7;">Security notice: If you didn't create this account, ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationEmail(input: {
  to: string;
  fullName: string;
  token: string;
  locale?: "ar" | "en";
  expiresInHours?: number;
}) {
  const config = getMailConfig();
  console.info("[auth-email] SMTP debug", {
    smtpHostExists: Boolean(config.host),
    smtpHost: config.host || null,
    smtpPort: config.port,
    smtpUser: config.user || null,
    smtpPassExists: Boolean(config.pass),
    smtpPassLength: config.pass ? config.pass.length : 0,
    smtpSecure: config.secure,
  });
  if (!config.host || !config.user || !config.pass || !config.from || Number.isNaN(config.port)) {
    console.error("[auth-email] SMTP configuration is incomplete. Verification email was not sent.");
    return { sent: false as const };
  }

  const locale = input.locale ?? "en";
  const expiresInHours = input.expiresInHours ?? 24;
  const baseUrl = getSiteUrl();
  const verifyUrl = `${baseUrl}/${locale}/verify-email?token=${encodeURIComponent(input.token)}`;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject: "Verify your Alpha Traders account",
    text: `Verify your email to activate your account: ${verifyUrl}\nThis link expires in ${expiresInHours} hours.`,
    html: buildVerificationEmailHtml({
      fullName: input.fullName,
      verifyUrl,
      expiresInHours,
    }),
  });

  return { sent: true as const, verifyUrl };
}
