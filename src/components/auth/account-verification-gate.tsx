"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Smartphone, Mail, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionUser = {
  email?: string;
  fullName?: string;
  emailVerified?: boolean;
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
};

type Props = {
  locale: "ar" | "en";
  redirectTo?: string;
  initialEmail: string;
  initialName: string;
};

type ApiErrorPayload = {
  error?: string;
  supportCode?: string;
  requestId?: string;
  message?: string;
};

function normalizeRedirectPath(rawRedirect: string | undefined, locale: "ar" | "en") {
  if (!rawRedirect) return "/usdt-exchange";
  if (!rawRedirect.startsWith("/") || rawRedirect.startsWith("//")) return "/usdt-exchange";
  if (rawRedirect === `/${locale}`) return "/";
  if (rawRedirect.startsWith(`/${locale}/`)) return rawRedirect.slice(`/${locale}`.length) || "/";
  return rawRedirect;
}

export function AccountVerificationGate({ locale, redirectTo, initialEmail, initialName }: Props) {
  const isAr = locale === "ar";
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [phoneForm, setPhoneForm] = useState({
    firstName: initialName.split(" ")[0] ?? "",
    lastName: initialName.split(" ").slice(1).join(" ") ?? "",
    displayName: initialName,
    phone: "",
    token: "",
  });
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);

  const target = useMemo(() => normalizeRedirectPath(redirectTo, locale), [redirectTo, locale]);
  const emailVerified = user?.emailVerified === true;
  const phoneVerified = Boolean(user?.verifiedPhone && user?.phoneVerifiedAt);

  useEffect(() => {
    let active = true;
    const readSession = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const payload = (await res.json()) as { user?: SessionUser | null; error?: string };
        if (!res.ok) throw new Error(payload.error ?? "Failed to load account state.");
        if (!active) return;
        setUser(payload.user ?? null);
        if (!payload.user) {
          window.location.assign(`/${locale}/login?redirectTo=/${locale}/verify-account`);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load account state.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void readSession();
    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!loading && emailVerified && phoneVerified) {
      window.location.replace(`/${locale}${target === "/" ? "" : target}`);
    }
  }, [loading, emailVerified, phoneVerified, locale, target]);

  async function refreshUser() {
    const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
    const payload = (await res.json()) as { user?: SessionUser | null };
    setUser(payload.user ?? null);
  }

  async function sendOtp() {
    setSendingOtp(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(phoneForm),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Failed to send verification code."));
      setStatus(payload.message ?? (isAr ? "تم إرسال رمز التحقق." : "Verification code sent."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtp() {
    setVerifyingOtp(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneForm.phone, token: phoneForm.token }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Verification failed."));
      setStatus(isAr ? "تم تفعيل رقم الهاتف بنجاح." : "Phone verification completed.");
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function resendVerificationEmail() {
    setResendingEmail(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email ?? initialEmail }),
      });
      const payload = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to resend verification email.");
      setStatus(payload.message ?? (isAr ? "تم إرسال رسالة تحقق جديدة." : "A new verification email has been sent."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend verification email.");
    } finally {
      setResendingEmail(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-3xl p-6 md:p-8">
        <div className="rounded-2xl border border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/10 via-black/30 to-black/50 p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/15 text-[#E8C547]">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">
                {isAr ? "أكمل التحقق للدخول إلى Alpha Exchange" : "Complete verification to access Alpha Exchange"}
              </h1>
              <p className="mt-2 text-sm text-[#D1D5DB]">
                {isAr
                  ? "نطلب التحقق من البريد ورقم الهاتف لحماية التداولات، تقليل الاحتيال، وضمان تجربة آمنة للجميع."
                  : "We require email and phone verification to protect trades, reduce fraud, and keep Alpha Exchange secure for all users."}
              </p>
            </div>
          </div>
        </div>

        {loading ? <p className="mt-5 text-sm text-[#9CA3AF]">{isAr ? "جاري تحميل حالة التحقق..." : "Loading verification status..."}</p> : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <Mail className="h-4 w-4 text-[#C9A227]" />
                {isAr ? "تحقق البريد الإلكتروني" : "Email verification"}
              </p>
              {emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {isAr ? "مؤكد" : "Verified"}
                </span>
              ) : (
                <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                  {isAr ? "مطلوب" : "Required"}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-[#9CA3AF]">{user?.email ?? initialEmail}</p>
            {!emailVerified ? (
              <Button
                type="button"
                className="mt-4 w-full"
                variant="secondary"
                loading={resendingEmail}
                loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                onClick={() => void resendVerificationEmail()}
              >
                {isAr ? "إعادة إرسال بريد التحقق" : "Resend verification email"}
              </Button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <Smartphone className="h-4 w-4 text-[#C9A227]" />
                {isAr ? "تحقق رقم الهاتف" : "Phone verification"}
              </p>
              {phoneVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {isAr ? "مؤكد" : "Verified"}
                </span>
              ) : (
                <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                  {isAr ? "مطلوب" : "Required"}
                </span>
              )}
            </div>
            {phoneVerified ? (
              <p className="mt-2 text-sm text-[#9CA3AF]">{user?.verifiedPhone}</p>
            ) : (
              <div className="mt-3 grid gap-2">
                <Input
                  value={phoneForm.firstName}
                  onChange={(event) => setPhoneForm((prev) => ({ ...prev, firstName: event.target.value }))}
                  placeholder={isAr ? "الاسم الأول" : "First name"}
                  aria-label={isAr ? "الاسم الأول" : "First name"}
                />
                <Input
                  value={phoneForm.lastName}
                  onChange={(event) => setPhoneForm((prev) => ({ ...prev, lastName: event.target.value }))}
                  placeholder={isAr ? "اسم العائلة" : "Last name"}
                  aria-label={isAr ? "اسم العائلة" : "Last name"}
                />
                <Input
                  value={phoneForm.phone}
                  onChange={(event) => setPhoneForm((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder={isAr ? "رقم الهاتف (+972 / 05...)" : "Phone (+972 / 05...)"}
                  aria-label={isAr ? "رقم الهاتف" : "Phone"}
                />
                <Button
                  type="button"
                  loading={sendingOtp}
                  loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                  disabled={!phoneForm.firstName || !phoneForm.lastName || !phoneForm.phone}
                  onClick={() => void sendOtp()}
                >
                  {isAr ? "إرسال رمز التحقق" : "Send verification code"}
                </Button>
                <Input
                  value={phoneForm.token}
                  onChange={(event) => setPhoneForm((prev) => ({ ...prev, token: event.target.value }))}
                  placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                  aria-label={isAr ? "رمز التحقق" : "Verification code"}
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={verifyingOtp}
                  loadingLabel={isAr ? "جارٍ التحقق..." : "Verifying..."}
                  disabled={phoneForm.token.length !== 6 || !phoneForm.phone}
                  onClick={() => void verifyOtp()}
                >
                  {isAr ? "تأكيد رقم الهاتف" : "Verify phone"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-[#9CA3AF]">
          <Link href="/onboarding" className="text-[#C9A227] hover:underline">
            {isAr ? "العودة إلى الإعداد الأولي" : "Back to onboarding"}
          </Link>
          <span>•</span>
          <Link href="/profile" className="text-[#C9A227] hover:underline">
            {isAr ? "فتح الملف الشخصي" : "Open profile"}
          </Link>
        </div>
      </div>
    </section>
  );
}
  function withSupportDetails(payload: ApiErrorPayload, fallback: string) {
    const message = payload.error ?? fallback;
    if (!payload.supportCode && !payload.requestId) return message;
    const suffix = [payload.supportCode, payload.requestId].filter(Boolean).join(" • ");
    return `${message} (${suffix})`;
  }
