"use client";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, Smartphone, Mail, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { LogoutButton } from "@/components/auth/logout-button";
import { PhoneVerificationChannelPicker } from "@/components/auth/phone-verification-channel-picker";
import type { PhoneVerificationChannel, PhoneVerificationChannels } from "@/lib/phone-verification-channel";
import { ClientRequestTimeoutError, fetchClientJson } from "@/lib/client-request-deadline";
import { normalizePhoneVerificationCodeInput } from "@/lib/phone-verification-code";
import type { PhoneVerificationRecovery } from "@/lib/phone-verification-recovery";

type Props = {
  locale: "ar" | "en";
  redirectTo?: string;
  initialUserId?: string;
  initialEmail: string;
  initialName: string;
  initialPhone?: string;
  initialPhoneVerificationRecovery?: PhoneVerificationRecovery | null;
  phoneVerificationEnabled: boolean;
  phoneVerificationRequired?: boolean;
  adultConfirmationRequired?: boolean;
  phoneVerificationChannels?: PhoneVerificationChannels;
};

type ApiErrorPayload = {
  ok?: boolean;
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

export function AccountVerificationGate(props: Props) {
  const session = useCanonicalSession();
  return <AccountVerificationContent key={session.user?.id ?? "signed-out"} {...props} session={session} />;
}

function AccountVerificationContent({
  locale,
  redirectTo,
  initialUserId,
  initialEmail,
  initialName,
  initialPhone = "",
  initialPhoneVerificationRecovery,
  phoneVerificationEnabled,
  phoneVerificationRequired = false,
  adultConfirmationRequired = false,
  phoneVerificationChannels,
  session,
}: Props & { session: ReturnType<typeof useCanonicalSession> }) {
  const isAr = locale === "ar";
  const { user, isResolving: loading, error: sessionError, refresh } = session;
  // A restored challenge appears in server HTML. Keep controls disabled until
  // React can capture edits, so hydration cannot erase an early code entry.
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adultChecked, setAdultChecked] = useState(false);
  const [savingAdult, setSavingAdult] = useState(false);
  const [adultSignInRequired, setAdultSignInRequired] = useState(false);
  const adultRequest = useRef<AbortController | null>(null);
  const [redirectSessionReady, setRedirectSessionReady] = useState(false);
  const redirectRead = useRef<object | null>(null);
  const redirectStarted = useRef(false);

  const name = user?.fullName ?? initialName;
  const initialAccountMatches = initialUserId
    ? user?.id === initialUserId
    : user?.email?.toLowerCase() === initialEmail.toLowerCase();
  // Server props can survive a client account change. Only the exact account
  // that owns this metadata may resume its challenge, never an email match.
  const recovery = phoneVerificationEnabled && initialUserId === user?.id
    && initialPhoneVerificationRecovery?.accountId === user?.id
    && user?.isPhotoVerified !== true ? initialPhoneVerificationRecovery : null;
  const pendingChallenge = recovery?.pendingChallenge;
  const remainingFromSnapshot = (timestamp: string | null | undefined) => {
    const remaining = Date.parse(timestamp ?? "") - Date.parse(recovery?.observedAt ?? "");
    return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  };
  const [phoneForm, setPhoneForm] = useState({
    firstName: name.split(" ")[0] ?? "",
    lastName: name.split(" ").slice(1).join(" ") ?? "",
    displayName: name,
    phone: pendingChallenge?.phone ?? (user ? user.whatsappNumber || (initialAccountMatches ? initialPhone : "") : initialPhone),
    token: "",
  });
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [sentPhone, setSentPhone] = useState<string | null>(pendingChallenge?.phone ?? null);
  const [challengeExpiry, setChallengeExpiry] = useState<{ remainingMs: number } | null>(pendingChallenge
    ? { remainingMs: remainingFromSnapshot(pendingChallenge.expiresAt) } : null);
  const [resendDelay, setResendDelay] = useState<{ remainingMs: number } | null>(recovery?.resendAvailableAt
    ? { remainingMs: remainingFromSnapshot(recovery.resendAvailableAt) } : null);
  // Server-relative durations keep hydration stable and do not trust the phone's
  // wall clock. Once mounted, monotonic elapsed time advances the countdown.
  const [cooldownSeconds, setCooldownSeconds] = useState(Math.ceil(remainingFromSnapshot(recovery?.resendAvailableAt) / 1000));
  const [phoneChannel, setPhoneChannel] = useState<PhoneVerificationChannel>("sms");
  const phoneRequest = useRef<AbortController | null>(null);
  const emailRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    return () => {
      mounted.current = false;
      const phone = phoneRequest.current;
      const email = emailRequest.current;
      phoneRequest.current = null;
      emailRequest.current = null;
      redirectRead.current = null;
      phone?.abort();
      email?.abort();
      adultRequest.current?.abort();
      adultRequest.current = null;
    };
  }, []);

  function requestError(err: unknown, fallback: string) {
    if (err instanceof ClientRequestTimeoutError || err instanceof TypeError) {
      return isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.";
    }
    const detail = err instanceof Error ? err.message : "";
    return isAr ? (/[؀-ۿ]/.test(detail) ? detail : fallback) : (detail || fallback);
  }

  useEffect(() => {
    if (resendDelay === null) return;
    const deadline = performance.now() + resendDelay.remainingMs;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setResendDelay(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendDelay]);

  useEffect(() => {
    if (challengeExpiry === null) return;
    const expire = () => {
      setSentPhone(null);
      setChallengeExpiry(null);
      setPhoneForm(previous => ({ ...previous, token: "" }));
      setStatus(null);
    };
    const remaining = challengeExpiry.remainingMs;
    if (remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [challengeExpiry]);

  const target = useMemo(() => normalizeRedirectPath(redirectTo, locale), [redirectTo, locale]);
  const verificationReturn = `/${locale}/verify-account?redirectTo=${encodeURIComponent(`/${locale}${target === "/" ? "" : target}`)}`;
  const signInHref = `/login?redirectTo=${encodeURIComponent(verificationReturn)}`;
  const emailVerified = user?.emailVerified === true;
  const phoneVerified = user?.isPhotoVerified === true;
  const adultConfirmed = user?.adultConfirmed === true;
  const verificationComplete = !loading && !sessionError && emailVerified
    && (!phoneVerificationRequired || phoneVerified) && (!adultConfirmationRequired || adultConfirmed);
  const visibleError = error ?? (sessionError ? (isAr ? "تعذر تحميل حالة الحساب." : "Failed to load account state.") : null);

  useEffect(() => {
    if (!loading && !sessionError && !user) {
      window.location.assign(`/${locale}${signInHref}`);
    }
  }, [loading, locale, sessionError, signInHref, user]);

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
      phone: prev.phone || user.whatsappNumber || "",
    }));
  }, [user]);

  useEffect(() => {
    if (!verificationComplete || redirectSessionReady || redirectRead.current) return;
    const request = {};
    redirectRead.current = request;
    // A verified SSR principal can still have stale routing cookies. Await the
    // canonical response (coalescing its pending read) before leaving this page.
    // The navigation effect rechecks the latest user instead of this closure.
    void (async () => {
      try {
        const result = await refresh();
        if (mounted.current && redirectRead.current === request && result === "authenticated") {
          setRedirectSessionReady(true);
        }
      } finally {
        if (redirectRead.current === request) redirectRead.current = null;
      }
    })();
  }, [verificationComplete, redirectSessionReady, refresh]);

  useEffect(() => {
    if (verificationComplete && redirectSessionReady && !redirectStarted.current) {
      redirectStarted.current = true;
      window.location.replace(`/${locale}${target === "/" ? "" : target}`);
    }
  }, [verificationComplete, redirectSessionReady, locale, target]);

  async function confirmAdult() {
    if (!hydrated || !user || !adultChecked || adultSignInRequired || !mounted.current || adultRequest.current) return;
    const controller = new AbortController();
    adultRequest.current = controller;
    setSavingAdult(true);
    setError(null);
    try {
      const { response, payload } = await fetchClientJson<ApiErrorPayload>("/api/auth/age-eligibility", {
        method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }), signal: controller.signal,
      }, 15_000);
      if (!mounted.current || adultRequest.current !== controller) return;
      if (response.status === 401) {
        // Re-read authentication once; never replay the personal declaration.
        // The canonical provider redirects an anonymous account to sign-in.
        // Keep a recovery link if that read is temporarily unavailable.
        setAdultSignInRequired(true);
        const result = await refresh({ force: true });
        if (!mounted.current || adultRequest.current !== controller) return;
        const recovered = result === "authenticated";
        setAdultSignInRequired(!recovered);
        setError(recovered
          ? (isAr ? "تم تحديث جلستك. احفظ تأكيد العمر مجددًا." : "Your session has been refreshed. Please save your age confirmation again.")
          : (isAr ? "جلستك غير نشطة. سجّل الدخول مجددًا لحفظ تأكيد العمر." : "Your session is no longer active. Sign in again to save your age confirmation."));
        return;
      }
      if (!response.ok || payload.ok !== true) throw new Error("Unable to save confirmation. Please try again.");
      await refresh({ force: true });
    } catch {
      if (mounted.current && adultRequest.current === controller) setError(isAr
        ? "تعذر حفظ التأكيد. حاول مرة أخرى." : "Unable to save confirmation. Please try again.");
    } finally {
      if (adultRequest.current === controller) {
        adultRequest.current = null;
        if (mounted.current) setSavingAdult(false);
      }
    }
  }

  async function sendOtp() {
    if (!hydrated || !user || !mounted.current || phoneRequest.current || sendingOtp || verifyingOtp || cooldownSeconds > 0 || phoneVerificationChannels?.[phoneChannel] === false) return;
    const current = new AbortController();
    phoneRequest.current = current;
    setSendingOtp(true);
    setError(null);
    setStatus(null);
    try {
      const phone = phoneForm.phone.trim();
      if (!phone) {
        throw new Error(isAr ? "يرجى إدخال رقم هاتف صالح قبل إرسال رمز التحقق." : "Please enter a valid phone number before sending a verification code.");
      }
      const { response: res, payload } = await fetchClientJson<ApiErrorPayload>("/api/alpha-exchange/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ phone, channel: phoneChannel }),
        signal: current.signal,
      }, 30_000);
      if (!mounted.current || phoneRequest.current !== current) return;
      if (!res.ok || payload?.ok !== true) throw new Error(withSupportDetails(payload ?? {}, isAr ? "تعذر إرسال رمز التحقق." : "Failed to send verification code.", isAr));
      setSentPhone(phone);
      setChallengeExpiry({ remainingMs: 10 * 60_000 });
      setPhoneForm(previous => ({ ...previous, token: "" }));
      setResendDelay({ remainingMs: 60_000 });
      setCooldownSeconds(60);
      setStatus(payload.message ?? (isAr ? "تم إرسال رمز التحقق إلى هاتفك." : "Verification code sent to your phone."));
    } catch (err) {
      if (mounted.current && phoneRequest.current === current) {
        setError(requestError(err, isAr ? "تعذر إرسال رمز التحقق." : "Failed to send verification code."));
      }
    } finally {
      if (mounted.current && phoneRequest.current === current) {
        phoneRequest.current = null;
        setSendingOtp(false);
      }
    }
  }

  async function verifyOtp() {
    if (!hydrated || !user || !mounted.current || phoneRequest.current || sendingOtp || verifyingOtp || !sentPhone || !/^\d{6}$/.test(phoneForm.token)) return;
    const current = new AbortController();
    phoneRequest.current = current;
    setVerifyingOtp(true);
    setError(null);
    setStatus(null);
    try {
      const { response: res, payload } = await fetchClientJson<ApiErrorPayload>("/api/alpha-exchange/phone/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ phone: sentPhone, code: phoneForm.token }),
        signal: current.signal,
      }, 30_000);
      if (!mounted.current || phoneRequest.current !== current) return;
      if (!res.ok || payload?.ok !== true) throw new Error(withSupportDetails(payload ?? {}, isAr ? "فشل التحقق من الرمز." : "Verification failed.", isAr));
      setStatus(isAr ? "تم تفعيل رقم الهاتف بنجاح." : "Phone verification completed.");
      await refresh({ force: true });
    } catch (err) {
      if (mounted.current && phoneRequest.current === current) {
        setError(requestError(err, isAr ? "فشل التحقق من الرمز." : "Verification failed."));
      }
    } finally {
      if (mounted.current && phoneRequest.current === current) {
        phoneRequest.current = null;
        setVerifyingOtp(false);
      }
    }
  }

  async function resendVerificationEmail() {
    if (!hydrated || !user || !mounted.current || emailRequest.current) return;
    const current = new AbortController();
    emailRequest.current = current;
    setResendingEmail(true);
    setError(null);
    setStatus(null);
    try {
      const { response: res, payload } = await fetchClientJson<ApiErrorPayload>("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ email: user?.email ?? initialEmail }),
        signal: current.signal,
      }, 30_000);
      if (!mounted.current || emailRequest.current !== current) return;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(isAr ? "فشل إرسال بريد التحقق." : "Failed to resend verification email.");
      if (!res.ok) throw new Error(isAr ? "فشل إرسال بريد التحقق." : (payload.error ?? "Failed to resend verification email."));
      setStatus(isAr ? "تم إرسال رسالة تحقق جديدة." : (payload.message ?? "A new verification email has been sent."));
    } catch (err) {
      if (mounted.current && emailRequest.current === current) {
        setError(requestError(err, isAr ? "فشل إرسال بريد التحقق." : "Failed to resend verification email."));
      }
    } finally {
      if (mounted.current && emailRequest.current === current) {
        emailRequest.current = null;
        setResendingEmail(false);
      }
    }
  }

  if (!user) return <section className="section-container page-shell"><p role="status">{visibleError ?? (isAr ? "جاري تحميل حالة التحقق..." : "Loading verification status...")}</p></section>;

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
                  ? "وثّق حسابك"
                  : "Verify your account"}
              </h1>
              <p className="mt-2 text-sm text-[#D1D5DB]">
                {phoneVerificationRequired
                  ? (isAr
                    ? "وثّق بريدك وهاتفك لاستخدام المنصة."
                    : "Verify your email and phone to use the exchange.")
                  : phoneVerificationEnabled
                  ? (isAr
                    ? "وثّق بريدك للمتابعة. توثيق الهاتف اختياري."
                    : "Verify your email to continue. Phone verification is optional.")
                  : (isAr
                    ? "وثّق بريدك للمتابعة."
                    : "Verify your email to continue.")}
              </p>
            </div>
          </div>
        </div>

        {loading ? <p className="mt-5 text-sm text-[#9CA3AF]">{isAr ? "جاري تحميل حالة التحقق..." : "Loading verification status..."}</p> : null}

        <div className={`mt-6 grid gap-4 ${phoneVerificationEnabled ? "md:grid-cols-2" : ""}`}>
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
                disabled={!hydrated}
                loading={resendingEmail}
                loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                onClick={() => void resendVerificationEmail()}
              >
                {isAr ? "إعادة إرسال بريد التحقق" : "Resend verification email"}
              </Button>
            ) : null}
          </div>

          {phoneVerificationEnabled ? (
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
                    {phoneVerificationRequired ? (isAr ? "مطلوب" : "Required") : (isAr ? "اختياري" : "Optional")}
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
                  <PhoneVerificationChannelPicker locale={locale} value={phoneChannel} onChange={setPhoneChannel} disabled={!hydrated || sendingOtp || verifyingOtp} channels={phoneVerificationChannels} />
                  <p className="text-sm text-[#9CA3AF]">
                    {sentPhone
                      ? (isAr ? "إذا وصلك رمز، أدخله أدناه. لا تحتاج إلى طلب رمز جديد." : "If you already received a code, enter it below. You do not need to request another one.")
                      : (isAr ? "أرسل رمزًا لهاتفك. تنتهي صلاحيته بعد 10 دقائق." : "Send a code to your phone. It expires in 10 minutes.")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input
                      value={phoneForm.phone}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      maxLength={30}
                      disabled={!hydrated || sendingOtp || verifyingOtp}
                      onChange={(event) => {
                        setPhoneForm((prev) => ({ ...prev, phone: event.target.value, token: "" }));
                        setSentPhone(null);
                        setChallengeExpiry(null);
                        setStatus(null);
                      }}
                      placeholder={isAr ? "رقم الهاتف (+972 / 05...)" : "Phone (+972 / 05...)"}
                      aria-label={isAr ? "رقم الهاتف" : "Phone"}
                    />
                    <Button
                      type="button"
                      className="w-full sm:w-auto sm:min-w-[196px]"
                      loading={sendingOtp}
                      loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                      disabled={!hydrated || !phoneForm.phone.trim() || verifyingOtp || cooldownSeconds > 0 || phoneVerificationChannels?.[phoneChannel] === false}
                      onClick={() => void sendOtp()}
                    >
                      {cooldownSeconds > 0
                        ? (isAr ? `أعد الإرسال بعد ${cooldownSeconds} ثانية` : `Resend in ${cooldownSeconds}s`)
                        : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <Input
                      value={phoneForm.token}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      dir="ltr"
                      maxLength={6}
                      disabled={!hydrated || !sentPhone || sendingOtp || verifyingOtp}
                      onChange={(event) => setPhoneForm((prev) => ({ ...prev, token: normalizePhoneVerificationCodeInput(event.target.value) }))}
                      placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                      aria-label={isAr ? "رمز التحقق" : "Verification code"}
                    />
                    <Button
                      type="button"
                      className="w-full sm:w-auto sm:min-w-[196px]"
                      variant="secondary"
                      loading={verifyingOtp}
                      loadingLabel={isAr ? "جارٍ التحقق..." : "Verifying..."}
                      disabled={!hydrated || !/^\d{6}$/.test(phoneForm.token) || !sentPhone || sendingOtp}
                      onClick={() => void verifyOtp()}
                    >
                      {isAr ? "تأكيد رقم الهاتف" : "Verify phone"}
                    </Button>
                  </div>
                  <p className="text-sm text-[#6CAEFF]">
                    {isAr ? "رقمك ظاهر لك ولمالك المنصة فقط." : "Only you and the owner can see your number."}
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
          ) : null}
        </div>

        {adultConfirmationRequired && !adultConfirmed ? (
          <div className="mt-4 rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="font-semibold">{isAr ? "العمر المطلوب: 18 عامًا أو أكثر" : "Age requirement: 18 or older"}</h2>
            <label className="mt-3 flex items-start gap-3 text-sm">
              <input type="checkbox" checked={adultChecked} disabled={!hydrated || savingAdult}
                onChange={event => setAdultChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-[#C9A227]" />
              {isAr ? "أؤكد أن عمري 18 عامًا أو أكثر." : "I confirm that I am 18 or older."}
            </label>
            <Button type="button" className="mt-4 w-full" disabled={!hydrated || !adultChecked || loading || !user || adultSignInRequired}
              loading={savingAdult} onClick={() => void confirmAdult()}>
              {isAr ? "حفظ التأكيد" : "Save confirmation"}
            </Button>
          </div>
        ) : null}
        {visibleError ? <ActionFeedback as="p" role="alert" className="mt-4 text-sm text-rose-300">{visibleError}</ActionFeedback> : null}
        {adultSignInRequired ? <Link href={signInHref} className="mt-3 inline-block text-[#C9A227] underline">
          {isAr ? "تسجيل الدخول مجددًا" : "Sign in again"}
        </Link> : null}
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-[#9CA3AF]">
          {phoneVerificationRequired ? (
            <>
              <Link href="/support" className="text-[#C9A227] hover:underline">
                {isAr ? "الحصول على مساعدة" : "Get help"}
              </Link>
              <LogoutButton locale={locale} variant="ghost" idleLabel={isAr ? "تسجيل الخروج" : "Sign out"} />
            </>
          ) : (
            <>
          <Link href="/onboarding" className="text-[#C9A227] hover:underline">
            {isAr ? "العودة إلى الإعداد الأولي" : "Back to onboarding"}
          </Link>
          <span>•</span>
          <Link href="/profile" className="text-[#C9A227] hover:underline">
            {isAr ? "فتح الملف الشخصي" : "Open profile"}
          </Link>
            </>
          )}
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
