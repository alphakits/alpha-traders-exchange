"use client";


import { brandText, currencyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appendLoginJourneyServerTimeline, appendLoginJourneyStep, beginLoginJourney, noteLoginJourneyRedirectStart } from "@/lib/login-journey-trace";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { clearClientLocaleChoice, englishLocalePath } from "@/i18n/locale-preference";
import { Eye, EyeOff } from "lucide-react";
import { LoginAtmosphere } from "./login-atmosphere";
import styles from "./login-atmosphere.module.css";

const REMEMBER_ME_PREFERENCE = "alpha.auth.remember-me.v1";

type RedirectUser = { role?: string; roles?: string[]; sellerStatus?: string; sellerApprovalVerified?: boolean; onboardingSelection?: string; onboardingCompletedAt?: string } | null | undefined;

function loginDestination(locale: "ar" | "en", rawRedirect: string | undefined, user: RedirectUser) {
  const roles = user?.roles ?? [];
  const owner = roles.includes("owner") || user?.role === "owner";
  const admin = roles.includes("admin") || user?.role === "admin";
  const needsOnboarding = !user?.onboardingSelection && !user?.onboardingCompletedAt
    && ((roles.length === 1 && roles[0] === "guest") || user?.role === "guest");
  const fallback = owner ? "/" : admin ? "/admin/alpha-exchange"
    : user?.sellerStatus === "approved_seller" && user.sellerApprovalVerified === true ? "/dashboard/seller" : "/usdt-exchange";
  const candidate = rawRedirect?.startsWith("/") && !rawRedirect.startsWith("//") && !rawRedirect.includes("\\")
    && !/^\/(?:ar\/|en\/)?(?:login|register)(?:[/?#]|$)/.test(rawRedirect) ? rawRedirect : null;
  if (needsOnboarding && candidate) {
    try { sessionStorage.setItem("post_onboarding_redirect", candidate.replace(/^\/(ar|en)(?=\/|$)/, "") || "/"); } catch { /* Storage can be unavailable. */ }
  }
  const path = needsOnboarding ? "/onboarding" : candidate ?? fallback;
  return /^\/(ar|en)(?:\/|$)/.test(path) ? path : path === "/" ? `/${locale}` : `/${locale}${path}`;
}

export function LoginForm({
  locale,
  redirectTo,
  passwordResetSuccess = false,
  sessionExpired = false,
}: {
  locale: "ar" | "en";
  redirectTo?: string;
  passwordResetSuccess?: boolean;
  sessionExpired?: boolean;
}) {
  const isAr = locale === "ar";
  const canonicalSession = useOptionalCanonicalSession();
  const recoveredUser = canonicalSession && !canonicalSession.isResolving && !canonicalSession.error ? canonicalSession.user : null;
  const redirectStartedRef = useRef(false);
  const [form, setForm] = useState({ email: "", password: "", rememberMe: true });
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage, statusMessageFeedbackKey] = useActionFeedbackState<string | null>(
    sessionExpired
      ? (isAr ? "انتهت جلستك. يُرجى تسجيل الدخول مرة أخرى." : "Your session expired. Please sign in again.")
      : passwordResetSuccess
      ? (isAr
        ? "تم تحديث كلمة المرور بنجاح. يُرجى تسجيل الدخول."
        : "Your password has been updated successfully. Please sign in.")
      : null,
  );
  const [errorMessage, setErrorMessage, errorMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [isResendVerificationSubmitting, setIsResendVerificationSubmitting] = useState(false);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Store only the checkbox preference. Credentials stay in the form and
    // authentication remains in the existing server-issued HttpOnly cookie.
    try {
      const saved = localStorage.getItem(REMEMBER_ME_PREFERENCE);
      if (saved === "true" || saved === "false") {
        setForm((previous) => ({ ...previous, rememberMe: saved === "true" }));
      }
    } catch { /* Private/restricted storage must not prevent sign-in. */ }
    setHydrated(true);
    const hidePassword = () => { if (document.hidden) setShowPassword(false); };
    document.addEventListener("visibilitychange", hidePassword);
    return () => document.removeEventListener("visibilitychange", hidePassword);
  }, []);
  useEffect(() => {
    // A restored phone document can still show Login even though its HttpOnly
    // cookie is valid. Return only after a fresh server session check succeeds.
    if (!recoveredUser || isLoginSubmitting || redirectStartedRef.current) return;
    redirectStartedRef.current = true;
    window.location.replace(loginDestination(locale, redirectTo, recoveredUser));
  }, [isLoginSubmitting, locale, recoveredUser, redirectTo]);

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    const clickStartedAt = Date.now();
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    setRequiresEmailVerification(false);
    if (isLoginSubmitting) return;
    setShowPassword(false);
    setIsLoginSubmitting(true);
    beginLoginJourney();
    appendLoginJourneyStep("User clicks Login", clickStartedAt, Date.now());
    try {
      const loginFetchStartedAt = Date.now();
      const response = await fetch("/api/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify(form),
      });
      appendLoginJourneyStep("HTTP response returned", loginFetchStartedAt, Date.now(), {
        endpoint: "/api/auth/login",
        status: response.status,
      });
      appendLoginJourneyServerTimeline(response.headers?.get?.("X-Auth-Login-Timeline") ?? null);
      let payload: {
        error?: string;
        user?: { role?: string; roles?: string[]; sellerStatus?: string; onboardingSelection?: string; onboardingCompletedAt?: string };
        requiresEmailVerification?: boolean;
      } | null = null;
      try {
        payload = (await response.json()) as {
          error?: string;
          user?: { role?: string; roles?: string[]; sellerStatus?: string; onboardingSelection?: string; onboardingCompletedAt?: string };
          requiresEmailVerification?: boolean;
        };
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const needsVerification = payload?.requiresEmailVerification === true;
        setRequiresEmailVerification(needsVerification);
        setErrorMessage(isAr
          ? (needsVerification ? "يجب تأكيد بريدك الإلكتروني قبل تسجيل الدخول." : "تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.")
          : (payload?.error ?? "Login failed."));
        return;
      }

      const userForRedirect = payload?.user;
      if (!userForRedirect) {
        setErrorMessage(
          isAr
            ? "تم تسجيل الدخول ولكن تعذر تأكيد الجلسة. حاول مرة أخرى."
            : "Logged in, but we couldn't confirm your session. Please try again.",
        );
        return;
      }

      // A new authenticated session always starts in English. A restored
      // existing session above retains the language selected during that session.
      clearClientLocaleChoice();
      const target = englishLocalePath(loginDestination("en", redirectTo, userForRedirect));
      noteLoginJourneyRedirectStart(Date.now());
      window.dispatchEvent(new Event("alpha-auth-changed"));
      redirectStartedRef.current = true;
      window.location.replace(target);
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsLoginSubmitting(false);
    }
  }

  async function handleResendVerification() {
    setStatusMessage(null);
    setErrorMessage(null);
    if (isResendVerificationSubmitting) return;
    setIsResendVerificationSubmitting(true);
    try {
      const response = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ email: form.email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(isAr ? "فشل إرسال بريد التحقق." : (payload.error ?? "Failed to resend verification email."));
        return;
      }
      setStatusMessage(
        isAr
          ? "إذا كان الحساب موجودًا وغير موثق، تم إرسال رسالة تحقق جديدة."
          : (payload.message ?? "If the account exists and is unverified, a new verification email has been sent."),
      );
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResendVerificationSubmitting(false);
    }
  }

  return (
    <section className={styles.page}>
      <LoginAtmosphere />
      <div className={`${styles.card} mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border lg:grid-cols-[1.05fr_0.95fr]`}>
        <div className="relative hidden overflow-hidden border-r border-white/10 bg-[radial-gradient(circle_at_22%_20%,rgba(201,162,39,0.2),transparent_34%),radial-gradient(circle_at_80%_22%,rgba(147,197,253,0.16),transparent_28%),linear-gradient(160deg,#050505,#0b0b0b_52%,#111827)] p-10 lg:flex lg:flex-col">
          <div className="absolute inset-0 opacity-40">
            <div className="absolute left-14 top-16 h-40 w-40 rounded-full bg-[#C9A227]/10 blur-3xl" />
            <div className="absolute right-14 top-28 h-32 w-32 rounded-full bg-[#93C5FD]/10 blur-3xl" />
            <div className="absolute bottom-16 left-20 h-48 w-48 rounded-full bg-[#C9A227]/8 blur-3xl" />
          </div>
          <div className="relative z-10">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#D4AF37]">{brandText("Alpha Traders")}</p>
            <h2 className="mt-6 max-w-md text-4xl font-semibold leading-tight text-white">
              {isAr ? "دخول احترافي إلى Alpha Academy و Alpha Exchange." : "Premium access to Alpha Academy and Alpha Exchange."}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-[#D1D5DB]">
              {isAr ? "تجربة تسجيل دخول مصممة لبيئة تداول احترافية: سرعة، وضوح، وثقة في كل خطوة." : "A modern black-and-gold financial login experience built for clarity, trust, and fast access to your trading workspace."}
            </p>
          </div>
          <div className="relative z-10 mt-8 grid gap-3">
            {[
              isAr ? "حفظ تقدّمك في الأكاديمية" : "Save Academy progress",
              isAr ? "الوصول إلى دوراتك وصفقاتك" : "Access your courses and active trades",
              isAr ? "شراء وبيع USDT بثقة" : "Buy and sell USDT with confidence",
              isAr ? "استلام الإشعارات والتحديثات" : "Stay in sync with notifications and updates",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-[#E5E7EB] backdrop-blur">
                {currencyText(item)}
              </div>
            ))}
          </div>
          <div className="relative z-10 mt-auto grid gap-3 pt-8">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "لوحة التداول" : "Trading Workspace"}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-[#9CA3AF]"><span className="currency-usdt">USDT</span> / ILS</p>
                  <p className="mt-1 text-lg font-semibold text-white">{isAr ? "مباشر" : "LIVE"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "أمان الحساب" : "Account Security"}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{isAr ? "محمي" : "PROTECTED"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative p-5 sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(201,162,39,0.08),transparent_36%)]" />
          <div className="relative z-10 mx-auto w-full max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#9CA3AF]">
              {isAr ? "تجربة دخول مميزة" : "Premium Sign In"}
            </p>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white md:text-4xl">{isAr ? "تسجيل الدخول" : "Login"}</h1>
            <p className="mt-3 max-w-lg text-sm leading-7 text-[#9CA3AF]">
              {brandText(isAr ? "أهلًا بعودتك إلى Alpha Traders. سجّل الدخول لمتابعة صفقاتك ودوراتك." : "Welcome back to Alpha Traders. Sign in to your trades and courses.")}
            </p>

            <div className="mt-6 hidden gap-3 rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/8 p-4 text-sm text-[#E5E7EB] sm:grid sm:grid-cols-2">
              {(isAr
                ? ["حفظ تقدّمك في الأكاديمية", "الوصول إلى دوراتك", "شراء وبيع USDT بأمان", "استلام الإشعارات", "بناء ملفك كمتداول", "تتبّع رحلتك في التداول"]
                : ["Save Academy progress", "Access your courses", "Buy & sell USDT securely", "Receive notifications", "Build your trader profile", "Track your trading journey"]
              ).map((item) => (
                <div key={item} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">{currencyText(item)}</div>
              ))}
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleLoginSubmit} data-hydrated={hydrated ? "true" : "false"}>
              <div className="grid gap-2">
                <label htmlFor="login-email" className="text-sm text-[#B7B7B7]">{isAr ? "البريد الإلكتروني" : "Email"}</label>
                <Input id="login-email" name="email" aria-label={isAr ? "البريد الإلكتروني" : "Email"} placeholder="you@example.com" type="email" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} className="h-12 rounded-2xl border-white/15 bg-black/30 text-base text-white placeholder:text-[#6B7280] focus-visible:border-[#C9A227]" />
              </div>
              <div className="grid gap-2">
                <label htmlFor="login-password" className="text-sm text-[#B7B7B7]">{isAr ? "كلمة المرور" : "Password"}</label>
                <div className="relative">
                  <Input id="login-password" name="password" aria-label={isAr ? "كلمة المرور" : "Password"} placeholder="••••••••" type={showPassword ? "text" : "password"} dir="ltr" autoComplete="current-password" autoCapitalize="none" spellCheck={false} required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} className="h-12 rounded-2xl border-white/15 bg-black/30 pr-14 text-base text-white placeholder:text-[#6B7280] focus-visible:border-[#C9A227]" />
                  <button
                    type="button"
                    aria-label={showPassword ? (isAr ? "إخفاء كلمة المرور" : "Hide password") : (isAr ? "إظهار كلمة المرور" : "Show password")}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-xl text-[#D4AF37] transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[#D1D5DB]">
                  <input name="rememberMe" type="checkbox" checked={form.rememberMe} onChange={(event) => {
                    const checked = event.target.checked;
                    setForm((prev) => ({ ...prev, rememberMe: checked }));
                    try { localStorage.setItem(REMEMBER_ME_PREFERENCE, String(checked)); } catch { /* Storage is optional. */ }
                  }} className="h-5 w-5 rounded border-white/30 bg-transparent accent-[#C9A227]" />
                  {isAr ? "تذكرني" : "Remember Me"}
                </label>
                <Link href="/forgot-password" className="inline-flex min-h-11 items-center rounded-md px-1 text-[#C9A227] transition hover:text-[#F4D87A] hover:underline">
                  {isAr ? "هل نسيت كلمة المرور؟" : "Forgot your password?"}
                </Link>
              </div>
              <Button type="submit" className="h-12 text-base" loading={isLoginSubmitting} loadingLabel={isAr ? "جاري تسجيل الدخول..." : "Logging in..."}>
                {isAr ? "تسجيل الدخول" : "Login"}
              </Button>
            </form>

            {errorMessage ? <ActionFeedback revealKey={errorMessageFeedbackKey} as="p" role="alert" className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{currencyText(errorMessage)}</ActionFeedback> : null}
            {requiresEmailVerification ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                loading={isResendVerificationSubmitting}
                loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                onClick={handleResendVerification}
              >
                {isAr ? "إعادة إرسال بريد التحقق" : "Resend verification email"}
              </Button>
            ) : null}
            {statusMessage ? <ActionFeedback revealKey={statusMessageFeedbackKey} as="p" className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200" role="status" aria-live="polite">{currencyText(statusMessage)}</ActionFeedback> : null}

            <p className="mt-6 text-sm text-[#9CA3AF]">
              {isAr ? "ليس لديك حساب؟" : "Don’t have an account?"}{" "}
              <Link href="/register" className="inline-flex min-h-11 items-center rounded-md px-1 text-[#C9A227] transition hover:text-[#F4D87A] hover:underline">
                {isAr ? "أنشئ حسابًا" : "Create Account"}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
