"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VerifyEmailPage({ params }: { params: { locale: string } }) {
  const isAr = params.locale === "ar";
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    async function verify() {
      if (!token || isVerifying || isVerified) return;
      setIsVerifying(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) {
          setErrorMessage(payload.error ?? (isAr ? "فشل التحقق من البريد." : "Email verification failed."));
          return;
        }
        setIsVerified(true);
        setStatusMessage(payload.message ?? (isAr ? "تم التحقق من البريد الإلكتروني بنجاح." : "Email verified successfully."));
      } catch {
        setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
      } finally {
        setIsVerifying(false);
      }
    }
    verify();
  }, [token, isAr, isVerifying, isVerified]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResending) return;
    setIsResending(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(payload.error ?? (isAr ? "فشل إرسال بريد التحقق." : "Failed to resend verification email."));
        return;
      }
      setStatusMessage(payload.message ?? (isAr ? "إذا كان الحساب موجودًا وغير موثق، تم إرسال رسالة جديدة." : "If the account exists and is unverified, a new verification email has been sent."));
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8">
        <h1 className="text-3xl font-semibold md:text-4xl">{isAr ? "تأكيد البريد الإلكتروني" : "Verify Email"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr
            ? "تحقق من بريدك الإلكتروني لتفعيل حساب Alpha Traders."
            : "Verify your email to activate your Alpha Traders account."}
        </p>

        {!token ? (
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

        {errorMessage ? <p className="mt-4 text-sm text-rose-300">{errorMessage}</p> : null}
        {statusMessage ? <p className="mt-4 text-sm text-emerald-300">{statusMessage}</p> : null}

        <p className="mt-6 text-sm text-[#9CA3AF]">
          <Link href="/login" className="text-[#C9A227] hover:underline">
            {isAr ? "العودة إلى تسجيل الدخول" : "Back to Sign In"}
          </Link>
        </p>
      </div>
    </section>
  );
}
