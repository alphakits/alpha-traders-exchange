"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Smartphone, Mail, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";

type Props = {
  locale: "ar" | "en";
  redirectTo?: string;
  initialEmail: string;
  initialName: string;
  phoneVerificationEnabled: boolean;
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

export function AccountVerificationGate({
  locale,
  redirectTo,
  initialEmail,
  initialName,
  phoneVerificationEnabled,
}: Props) {
  const isAr = locale === "ar";
  const { user, isResolving: loading, error: sessionError, refresh } = useCanonicalSession();
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
  const phoneVerified = user?.isPhotoVerified === true;
  const visibleError = error ?? (sessionError ? (isAr ? "تعذر تحميل حالة الحساب." : "Failed to load account state.") : null);

  useEffect(() => {
    if (!loading && !sessionError && !user) {
      window.location.assign(`/${locale}/login?redirectTo=/${locale}/verify-account`);
    }
  }, [loading, locale, sessionError, user]);

  useEffect(() => {
    if (!user?.fullName?.trim()) return;
    const parts = user.fullName.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ");
    setPhoneForm((prev) => ({
      ...prev,
      firstName: prev.firstName || firstName,
      lastName: prev.lastName || lastName,
      displayName: prev.displayName || user.fullName || "",
    }));
  }, [user]);

  useEffect(() => {
    if (!loading && !sessionError && emailVerified) {
      window.location.replace(`/${locale}${target === "/" ? "" : target}`);
    }
  }, [loading, sessionError, emailVerified, locale, target]);

  async function sendOtp() {
    setSendingOtp(true);
    setError(null);
    setStatus(null);
    try {
      const sourceName = [phoneForm.firstName, phoneForm.lastName].filter(Boolean).join(" ").trim() || user?.fullName?.trim() || initialName.trim();
      const nameParts = sourceName.split(/\s+/).filter(Boolean);
      const firstName = (phoneForm.firstName || nameParts[0] || "").trim();
      const lastName = (phoneForm.lastName || nameParts.slice(1).join(" ") || "").trim();
      if (!firstName || !lastName || !phoneForm.phone.trim()) {
        throw new Error(isAr ? "يرجى إدخال رقم هاتف صالح قبل إرسال رمز التحقق." : "Please enter a valid phone number before sending a verification code.");
      }
      const res = await fetch("/api/auth/onboarding/buyer/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({
          firstName,
          lastName,
          displayName: user?.fullName?.trim() || phoneForm.displayName || sourceName,
          phone: phoneForm.phone.trim(),
        }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, isAr ? "تعذر إرسال رمز التحقق." : "Failed to send verification code.", isAr));
      setStatus(isAr ? "تم إرسال رمز التحقق." : (payload.message ?? "Verification code sent."));
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr
        ? (/[؀-ۿ]/.test(detail) ? detail : "تعذر إرسال رمز التحقق.")
        : (detail || "Failed to send verification code."));
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
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ phone: phoneForm.phone, token: phoneForm.token }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, isAr ? "فشل التحقق من الرمز." : "Verification failed.", isAr));
      setStatus(isAr ? "تم تفعيل رقم الهاتف بنجاح." : "Phone verification completed.");
      await refresh({ force: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr ? "فشل التحقق من الرمز." : (detail || "Verification failed."));
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
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ email: user?.email ?? initialEmail }),
      });
      const payload = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(isAr ? "فشل إرسال بريد التحقق." : (payload.error ?? "Failed to resend verification email."));
      setStatus(isAr ? "تم إرسال رسالة تحقق جديدة." : (payload.message ?? "A new verification email has been sent."));
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr ? "فشل إرسال بريد التحقق." : (detail || "Failed to resend verification email."));
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
                {isAr
                  ? "أكمل التحقق للدخول إلى Alpha Exchange"
                  : "Complete verification to access Alpha Exchange"}
              </h1>
              <p className="mt-2 text-sm text-[#D1D5DB]">
                {isAr
                  ? "التحقق من البريد الإلكتروني مطلوب للوصول إلى Alpha Exchange. التحقق من الهاتف اختياري ولا يمنع تداول المشتري."
                  : "Email verification is required to access Alpha Exchange. Phone verification is optional and does not block Buyer trading."}
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
              {phoneVerificationEnabled ? (
                phoneVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    {isAr ? "مؤكد" : "Verified"}
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                    {isAr ? "اختياري" : "Optional"}
                  </span>
                )
              ) : (
                <span className="rounded-full border border-sky-400/35 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
                  {isAr ? "سيتوفر قريبًا" : "Coming soon"}
                </span>
              )}
            </div>
            {phoneVerificationEnabled ? (
              phoneVerified ? (
                <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "تم التحقق من رقم هاتفك." : "Your phone number is verified."}</p>
              ) : (
                <div className="mt-3 grid gap-3">
                  <p className="text-xs text-[#9CA3AF]">
                    {isAr ? "التحقق من الهاتف اختياري ويمكنك إكماله من هنا إذا رغبت." : "Phone verification is optional; you may complete it here if you choose."}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input
                      value={phoneForm.phone}
                      onChange={(event) => setPhoneForm((prev) => ({ ...prev, phone: event.target.value }))}
                      placeholder={isAr ? "رقم الهاتف (+972 / 05...)" : "Phone (+972 / 05...)"}
                      aria-label={isAr ? "رقم الهاتف" : "Phone"}
                    />
                    <Button
                      type="button"
                      className="w-full sm:w-auto sm:min-w-[196px]"
                      loading={sendingOtp}
                      loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                      disabled={!phoneForm.phone.trim()}
                      onClick={() => void sendOtp()}
                    >
                      {isAr ? "إرسال رمز التحقق" : "Send verification code"}
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input
                      value={phoneForm.token}
                      onChange={(event) => setPhoneForm((prev) => ({ ...prev, token: event.target.value }))}
                      placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                      aria-label={isAr ? "رمز التحقق" : "Verification code"}
                    />
                    <Button
                      type="button"
                      className="w-full sm:w-auto sm:min-w-[196px]"
                      variant="secondary"
                      loading={verifyingOtp}
                      loadingLabel={isAr ? "جارٍ التحقق..." : "Verifying..."}
                      disabled={phoneForm.token.length !== 6 || !phoneForm.phone.trim()}
                      onClick={() => void verifyOtp()}
                    >
                      {isAr ? "تأكيد رقم الهاتف" : "Verify phone"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-[#6CAEFF]">
                    {isAr ? "لن يُشارك رقمك مع طرف التداول الآخر." : "Your number is not shared with the other trade participant."}
                  </p>
                </div>
              )
            ) : (
              <p className="mt-3 text-sm text-[#9CA3AF]">
                {isAr
                  ? "التحقق عبر الهاتف غير متاح حاليًا، وليس مطلوبًا لتداول المشتري."
                  : "Phone verification is currently unavailable and is not required for Buyer trading."}
              </p>
            )}
          </div>
        </div>

        {visibleError ? <p className="mt-4 text-sm text-rose-300">{visibleError}</p> : null}
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

function withSupportDetails(payload: ApiErrorPayload, fallback: string, isAr: boolean) {
  const message = isAr ? fallback : (payload.error ?? fallback);
  if (!payload.supportCode && !payload.requestId) return message;
  const suffix = [payload.supportCode, payload.requestId].filter(Boolean).join(" • ");
  return `${message} (${suffix})`;
}
