"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VerifyEmailPage() {
  const locale = useLocale();
  const isAr = locale === "ar";
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const tokenHash = searchParams.get("token_hash") ?? "";
  const tokenType = searchParams.get("type") ?? "signup";
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const attemptedVerificationRef = useRef<string | null>(null);

  useEffect(() => {
    async function verify() {
      if (!token && !tokenHash) return;
      const attemptKey = `${token}\u0000${tokenHash}\u0000${tokenType}\u0000${locale}`;
      if (attemptedVerificationRef.current === attemptKey) return;
      attemptedVerificationRef.current = attemptKey;
      setIsVerifying(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Locale": locale },
          body: JSON.stringify({ token, tokenHash, type: tokenType }),
        });
        const payload = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) {
          setErrorMessage(isAr ? "فشل التحقق من البريد." : (payload.error ?? "Email verification failed."));
          return;
        }
        setIsVerified(true);
        setStatusMessage(isAr ? "تم التحقق من البريد الإلكتروني بنجاح." : (payload.message ?? "Email verified successfully."));
      } catch {
        setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
      } finally {
        setIsVerifying(false);
      }
    }
    verify();
  }, [token, tokenHash, tokenType, isAr, locale]);

  useEffect(() => {
    if (!isVerified) return;
    const timer = window.setTimeout(() => {
      window.location.assign(`/${locale}/login`);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [isVerified, locale]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResending) return;
    setIsResending(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(isAr ? "فشل إرسال بريد التحقق." : (payload.error ?? "Failed to resend verification email."));
        return;
      }
      setStatusMessage(isAr ? "إذا كان الحساب موجودًا وغير موثق، تم إرسال رسالة جديدة." : (payload.message ?? "If the account exists and is unverified, a new verification email has been sent."));
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "تأكيد البريد الإلكتروني" : "Verify Email"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr
            ? "تحقق من بريدك الإلكتروني لتفعيل حساب Alpha Traders."
            : "Verify your email to activate your Alpha Traders account."}
        </p>

        {!token && !tokenHash ? (
          <form className="mt-6 grid gap-3" onSubmit={handleResend}>
            <Input
              aria-label={isAr ? "البريد الإلكتروني" : "Email"}
              placeholder={isAr ? "البريد الإلكتروني" : "Email"}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" disabled={isResending}>
              {isResending
                ? (isAr ? "جارٍ الإرسال..." : "Sending...")
                : (isAr ? "إعادة إرسال بريد التحقق" : "Resend verification email")}
            </Button>
          </form>
        ) : (
          <div className="mt-6 text-sm text-[#D1D5DB]">
            {isVerifying
              ? (isAr ? "جارٍ التحقق من الرابط..." : "Verifying your link...")
              : null}
          </div>
        )}

        {errorMessage ? <p className="mt-4 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
        {statusMessage ? <p className="mt-4 text-sm text-emerald-300" role="status" aria-live="polite">{statusMessage}</p> : null}

        <p className="mt-6 text-sm text-[#9CA3AF]">
          <Link href="/login" className="text-[#C9A227] hover:underline">
            {isAr ? "العودة إلى تسجيل الدخول" : "Back to Sign In"}
          </Link>
        </p>
      </div>
    </section>
  );
}
