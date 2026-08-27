"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RegistrationErrorCode =
  | "REGISTRATION_RATE_LIMITED"
  | "REQUIRED_FIELDS"
  | "FIELD_TOO_LONG"
  | "INVALID_EMAIL"
  | "EMAIL_ALREADY_REGISTERED"
  | "TERMS_REQUIRED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_MISMATCH"
  | "REGISTRATION_FAILED";

export function RegisterForm({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    whatsappNumber: "",
    agreedToTerms: false,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function localizeRegistrationError(error?: string, code?: RegistrationErrorCode) {
    const message = String(error ?? "").trim();
    const copyByCode: Record<RegistrationErrorCode, { ar: string; en: string }> = {
      REGISTRATION_RATE_LIMITED: {
        ar: "تم تقييد التسجيل مؤقتًا. يُرجى المحاولة مرة أخرى خلال بضع دقائق.",
        en: "Registration is temporarily rate-limited. Please try again in a few minutes.",
      },
      REQUIRED_FIELDS: {
        ar: "الاسم الكامل والبريد الإلكتروني وكلمة المرور مطلوبة.",
        en: "Full name, email, and password are required.",
      },
      FIELD_TOO_LONG: {
        ar: "تجاوز حقل واحد أو أكثر الحد المسموح.",
        en: "One or more fields exceed the allowed length.",
      },
      INVALID_EMAIL: {
        ar: "صيغة البريد الإلكتروني غير صحيحة.",
        en: "Enter a valid email address.",
      },
      EMAIL_ALREADY_REGISTERED: {
        ar: "البريد الإلكتروني مسجل بالفعل.",
        en: "Email already registered.",
      },
      TERMS_REQUIRED: {
        ar: "يجب الموافقة على شروط الخدمة.",
        en: "You must accept the Terms of Service.",
      },
      PASSWORD_TOO_SHORT: {
        ar: "يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل.",
        en: "Password must be at least 8 characters.",
      },
      PASSWORD_MISMATCH: {
        ar: "كلمتا المرور غير متطابقتين.",
        en: "Passwords do not match.",
      },
      REGISTRATION_FAILED: {
        ar: "تعذر إنشاء الحساب. يُرجى المحاولة مرة أخرى.",
        en: "Registration failed. Please try again.",
      },
    };
    if (code && copyByCode[code]) return copyByCode[code][locale];
    if (!message) return copyByCode.REGISTRATION_FAILED[locale];
    const normalized = message.toLowerCase();
    if (normalized.includes("temporarily rate-limited") || normalized.includes("too many registration attempts")) {
      return copyByCode.REGISTRATION_RATE_LIMITED[locale];
    }
    if (normalized.includes("email already registered") || normalized.includes("already exists")) return copyByCode.EMAIL_ALREADY_REGISTERED[locale];
    if (normalized.includes("full name") && normalized.includes("required")) return copyByCode.REQUIRED_FIELDS[locale];
    if (normalized.includes("exceed") && normalized.includes("length")) return copyByCode.FIELD_TOO_LONG[locale];
    if (normalized.includes("invalid email")) return copyByCode.INVALID_EMAIL[locale];
    if (normalized.includes("terms") && normalized.includes("accepted")) return copyByCode.TERMS_REQUIRED[locale];
    if (normalized.includes("password") && normalized.includes("at least")) return copyByCode.PASSWORD_TOO_SHORT[locale];
    if (normalized.includes("passwords do not match")) return copyByCode.PASSWORD_MISMATCH[locale];

    // Never expose an unexpected provider/database error in either locale.
    return copyByCode.REGISTRATION_FAILED[locale];
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Locale": locale,
        },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as { error?: string; code?: RegistrationErrorCode; message?: string };
      if (!response.ok) {
        setErrorMessage(localizeRegistrationError(payload.error, payload.code));
        return;
      }
      setStatusMessage(isAr
        ? "إذا كان البريد صالحًا للتسجيل، فستصلك رسالة تأكيد. إذا كان لديك حساب بالفعل، فسجّل الدخول أو أعد تعيين كلمة المرور."
        : "If this email can be registered, you will receive a confirmation message. If you already have an account, sign in or reset your password.");
      setForm({
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
        whatsappNumber: "",
        agreedToTerms: false,
      });
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "إنشاء حساب" : "Register"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr ? "أنشئ حساب Alpha Traders الخاص بك. تحقّق من بريدك الإلكتروني لتفعيل الحساب." : "Create your Alpha Traders account. Verify your email to activate your account."}
        </p>

        <form className="mt-6 grid gap-3" onSubmit={handleSubmit}>
          <Input aria-label={isAr ? "الاسم الكامل" : "Full Name"} placeholder={isAr ? "الاسم الكامل" : "Full Name"} autoComplete="name" maxLength={100} required value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} />
          <Input aria-label={isAr ? "البريد الإلكتروني" : "Email"} placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <Input aria-label={isAr ? "كلمة المرور" : "Password"} placeholder={isAr ? "كلمة المرور" : "Password"} type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          <Input aria-label={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} placeholder={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} type="password" autoComplete="new-password" minLength={8} required value={form.confirmPassword} onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))} />
          <Input aria-label={isAr ? "رقم واتساب اختياري" : "WhatsApp Number (optional)"} placeholder={isAr ? "رقم واتساب اختياري" : "WhatsApp Number (optional)"} autoComplete="tel" maxLength={30} value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} />
          <label className={`inline-flex items-start gap-2 text-sm text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
            <input
              type="checkbox"
              checked={form.agreedToTerms}
              onChange={(event) => setForm((prev) => ({ ...prev, agreedToTerms: event.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227]"
            />
            {isAr ? "أوافق على شروط الخدمة." : "I agree to the Terms of Service."}
          </label>
          <Button type="submit" loading={isSubmitting} loadingLabel={isAr ? "جاري الإنشاء..." : "Creating..."}>
            {isAr ? "إنشاء الحساب" : "Create Account"}
          </Button>
        </form>

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
        {statusMessage ? <p className="mt-3 text-sm text-emerald-300" role="status" aria-live="polite">{statusMessage}</p> : null}

        <p className="mt-5 text-sm text-[#9CA3AF]">
          {isAr ? "لديك حساب بالفعل؟" : "Already have an account?"}{" "}
          <Link href="/login" className="text-[#C9A227] hover:underline">
            {isAr ? "تسجيل الدخول" : "Login"}
          </Link>
        </p>
      </div>
    </section>
  );
}
