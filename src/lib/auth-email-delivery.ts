type Locale = "ar" | "en";

type MailPayload = {
  subject: string;
  text: string;
  html: string;
};

function buildVerificationEmail(locale: Locale, verificationLink: string): MailPayload {
  if (locale === "ar") {
    return {
      subject: "تحقق من بريدك الإلكتروني - Alpha Traders",
      text: `مرحبًا،\n\nمرحبًا بك في Alpha Traders. يرجى التحقق من بريدك الإلكتروني عبر الرابط التالي:\n${verificationLink}\n\nإذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة.\n`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
  <p>مرحبًا،</p>
  <p>مرحبًا بك في <strong>Alpha Traders</strong>. يرجى التحقق من بريدك الإلكتروني.</p>
  <p><a href="${verificationLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">تأكيد البريد الإلكتروني</a></p>
  <p>إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة.</p>
</div>`,
    };
  }
  return {
    subject: "Verify your email - Alpha Traders",
    text: `Hello,\n\nWelcome to Alpha Traders. Please verify your email using this secure link:\n${verificationLink}\n\nIf you did not create this account, you can ignore this email.\n`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
  <p>Hello,</p>
  <p>Welcome to <strong>Alpha Traders</strong>. Please verify your email.</p>
  <p><a href="${verificationLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">Verify email</a></p>
  <p>If you did not create this account, you can ignore this email.</p>
</div>`,
  };
}

function buildRecoveryEmail(locale: Locale, resetLink: string): MailPayload {
  if (locale === "ar") {
    return {
      subject: "إعادة تعيين كلمة المرور - Alpha Traders",
      text: `مرحبًا،\n\nتم طلب إعادة تعيين كلمة المرور لحسابك في Alpha Traders.\n\nاستخدم الرابط الآمن التالي لإعادة التعيين:\n${resetLink}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.\n`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
  <p>مرحبًا،</p>
  <p>تم طلب إعادة تعيين كلمة المرور لحسابك في <strong>Alpha Traders</strong>.</p>
  <p><a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">إعادة تعيين كلمة المرور</a></p>
  <p>إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.</p>
</div>`,
    };
  }
  return {
    subject: "Reset your password - Alpha Traders",
    text: `Hello,\n\nA password reset was requested for your Alpha Traders account.\n\nUse the secure link below to reset your password:\n${resetLink}\n\nIf you did not request this, you can ignore this email.\n`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
  <p>Hello,</p>
  <p>A password reset was requested for your <strong>Alpha Traders</strong> account.</p>
  <p><a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#C9A227;color:#111827;text-decoration:none;border-radius:8px;">Reset password</a></p>
  <p>If you did not request this, you can ignore this email.</p>
</div>`,
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
  const from = process.env.EMAIL_FROM ?? "";
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
