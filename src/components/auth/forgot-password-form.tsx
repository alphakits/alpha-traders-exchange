"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(payload.error ?? (isAr ? "فشل إرسال رابط إعادة التعيين." : "Failed to send reset link."));
        return;
      }
      setStatusMessage(
        payload.message ??
          (isAr
            ? "إذا كان الحساب موجودًا، تم إرسال رابط إعادة تعيين كلمة المرور."
            : "If the account exists, a password reset link has been sent."),
      );
      setEmail("");
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8">
        <h1 className="text-3xl font-semibold md:text-4xl">{isAr ? "نسيت كلمة المرور" : "Forgot Password"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr
            ? "أدخل بريدك الإلكتروني وسنرسل لك رابطًا آمنًا لإعادة تعيين كلمة المرور."
            : "Enter your email and we’ll send you a secure password reset link."}
        </p>

        <form className="mt-6 grid gap-3" onSubmit={handleSubmit}>
          <Input
            aria-label={isAr ? "البريد الإلكتروني" : "Email"}
            placeholder={isAr ? "البريد الإلكتروني" : "Email"}
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رابط إعادة التعيين" : "Send Reset Link")}
          </Button>
        </form>

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
        {statusMessage ? <p className="mt-3 text-sm text-emerald-300" role="status" aria-live="polite">{statusMessage}</p> : null}

        <p className="mt-5 text-sm text-[#9CA3AF]">
          <Link href="/login" className="text-[#C9A227] hover:underline">
            {isAr ? "العودة إلى تسجيل الدخول" : "Back to Sign In"}
          </Link>
        </p>
      </div>
    </section>
  );
}
