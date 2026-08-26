import { getSiteUrl } from "@/lib/site-url";
import { BRAND_NAME, BRAND_NAME_HTML, getBrandedEmailFrom } from "@/lib/brand";

type Locale = "ar" | "en";

type MailPayload = {
  subject: string;
  text: string;
  html: string;
};

const BRAND_LOGO_PATH = "/images/brand/alpha-traders-logo.png";

function renderAuthEmail(locale: Locale, content: string) {
  const logoUrl = new URL(BRAND_LOGO_PATH, getSiteUrl()).toString();
  const direction = locale === "ar" ? "rtl" : "ltr";

  return `<!doctype html>
<html lang="${locale}" dir="${direction}">
  <body style="margin:0;background:#050505;color:#f9fafb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111111;border:1px solid #3f3513;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:24px;background:#171308;border-bottom:1px solid #3f3513;">
                <img src="${logoUrl}" width="88" height="88" alt="${BRAND_NAME_HTML}" style="display:block;width:88px;height:88px;margin:0 auto;border-radius:18px;object-fit:cover;" />
                <div style="margin-top:12px;font-size:12px;letter-spacing:2px;color:#d6b84c;text-transform:uppercase;">${BRAND_NAME_HTML}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:26px;color:#e5e7eb;font-size:16px;line-height:1.7;">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px;border-top:1px solid #2b2b2b;background:#0a0a0a;color:#8f8f8f;font-size:12px;line-height:1.7;">
                ${BRAND_NAME_HTML}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildVerificationEmail(locale: Locale, verificationLink: string): MailPayload {
  if (locale === "ar") {
    return {
      subject: `تحقق من بريدك الإلكتروني - ${BRAND_NAME}`,
      text: `مرحبًا،\n\nمرحبًا بك في ${BRAND_NAME}. يرجى التحقق من بريدك الإلكتروني عبر الرابط التالي:\n${verificationLink}\n\nإذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة.\n`,
      html: renderAuthEmail(locale, `<div dir="rtl">
  <p>مرحبًا،</p>
  <p>مرحبًا بك في <strong>${BRAND_NAME_HTML}</strong>. يرجى التحقق من بريدك الإلكتروني.</p>
  <p><a href="${verificationLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">تأكيد البريد الإلكتروني</a></p>
  <p>إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة.</p>
</div>`),
    };
  }
  return {
    subject: `Verify your email - ${BRAND_NAME}`,
    text: `Hello,\n\nWelcome to ${BRAND_NAME}. Please verify your email using this secure link:\n${verificationLink}\n\nIf you did not create this account, you can ignore this email.\n`,
    html: renderAuthEmail(locale, `<div>
  <p>Hello,</p>
  <p>Welcome to <strong>${BRAND_NAME_HTML}</strong>. Please verify your email.</p>
  <p><a href="${verificationLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">Verify email</a></p>
  <p>If you did not create this account, you can ignore this email.</p>
</div>`),
  };
}

function buildRecoveryEmail(locale: Locale, resetLink: string): MailPayload {
  if (locale === "ar") {
    return {
      subject: `إعادة تعيين كلمة المرور - ${BRAND_NAME}`,
      text: `مرحبًا،\n\nتم طلب إعادة تعيين كلمة المرور لحسابك في ${BRAND_NAME}.\n\nاستخدم الرابط الآمن التالي لإعادة التعيين:\n${resetLink}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.\n`,
      html: renderAuthEmail(locale, `<div dir="rtl">
  <p>مرحبًا،</p>
  <p>تم طلب إعادة تعيين كلمة المرور لحسابك في <strong>${BRAND_NAME_HTML}</strong>.</p>
  <p><a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">إعادة تعيين كلمة المرور</a></p>
  <p>إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.</p>
</div>`),
    };
  }
  return {
    subject: `Reset your password - ${BRAND_NAME}`,
    text: `Hello,\n\nA password reset was requested for your ${BRAND_NAME} account.\n\nUse the secure link below to reset your password:\n${resetLink}\n\nIf you did not request this, you can ignore this email.\n`,
    html: renderAuthEmail(locale, `<div>
  <p>Hello,</p>
  <p>A password reset was requested for your <strong>${BRAND_NAME_HTML}</strong> account.</p>
  <p><a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">Reset password</a></p>
  <p>If you did not request this, you can ignore this email.</p>
</div>`),
  };
}

export function buildAuthEmail(kind: "verification" | "recovery", locale: Locale, link: string): MailPayload {
  return kind === "verification" ? buildVerificationEmail(locale, link) : buildRecoveryEmail(locale, link);
}

export async function sendAuthEmailViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = getBrandedEmailFrom(process.env.EMAIL_FROM ?? "");
  if (!apiKey || !from) {
    return { ok: false as const, reason: "resend_not_configured" as const };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    return { ok: false as const, reason: "resend_request_failed" as const };
  }
  return { ok: true as const };
}
