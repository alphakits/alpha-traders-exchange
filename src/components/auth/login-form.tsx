"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ locale, redirectTo }: { locale: "ar" | "en"; redirectTo?: string }) {
  const isAr = locale === "ar";
  const [form, setForm] = useState({ email: "", password: "", rememberMe: true });
  const [resetMode, setResetMode] = useState(false);
  const [resetRequestEmail, setResetRequestEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [isResetRequestSubmitting, setIsResetRequestSubmitting] = useState(false);
  const [isResendVerificationSubmitting, setIsResendVerificationSubmitting] = useState(false);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const defaultRedirectByRole = (
    user: { role?: string; roles?: string[]; sellerStatus?: string; onboardingSelection?: string; onboardingCompletedAt?: string } | null | undefined,
  ) => {
    const roles = user?.roles ?? [];
    const isOwner = roles.includes("owner") || user?.role === "owner";
    const isAdmin = roles.includes("admin") || user?.role === "admin";
    if (isOwner) return "/";
    if (isAdmin) return "/admin/alpha-exchange";
    const hasOnboardingChoice = Boolean(user?.onboardingSelection || user?.onboardingCompletedAt);
    if (!hasOnboardingChoice && ((roles.length === 1 && roles[0] === "guest") || (roles.length === 0 && user?.role === "guest"))) return "/onboarding";
    if (!isAdmin && user?.sellerStatus === "approved_seller") return "/dashboard/seller";
    return "/usdt-exchange";
  };

  function resolveLoginRedirectTarget(
    rawRedirect: string | undefined,
    user: { role?: string; roles?: string[]; sellerStatus?: string; onboardingSelection?: string; onboardingCompletedAt?: string } | null | undefined,
  ) {
    const fallback = defaultRedirectByRole(user);
    const roles = user?.roles ?? [];
    const needsOnboarding = !user?.onboardingSelection && !user?.onboardingCompletedAt && ((roles.length === 1 && roles[0] === "guest") || user?.role === "guest");
    if (needsOnboarding) {
      // Preserve the intended destination through onboarding via sessionStorage
      const intendedPath = normalizeRedirectPath(rawRedirect);
      if (intendedPath) {
        try { sessionStorage.setItem("post_onboarding_redirect", intendedPath); } catch { /* ignore */ }
      }
      return "/onboarding";
    }
    if (!rawRedirect) return fallback;
    return normalizeRedirectPath(rawRedirect) ?? fallback;
  }

  function normalizeRedirectPath(rawRedirect: string | undefined): string | null {
    if (!rawRedirect) return null;
    if (!rawRedirect.startsWith("/") || rawRedirect.startsWith("//")) return null;
    if (rawRedirect === `/${locale}`) return "/";
    if (rawRedirect.startsWith(`/${locale}/`)) {
      const localePath = rawRedirect.slice(`/${locale}`.length);
      return localePath || "/";
    }
    if (/^\/(ar|en)\/(?:login|register)(?:\/|$)/.test(rawRedirect)) return null;
    return rawRedirect;
  }

  function toLocaleHref(path: string) {
    if (/^\/(ar|en)(?:\/|$)/.test(path)) return path;
    if (path === "/") return `/${locale}`;
    return `/${locale}${path}`;
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    setRequiresEmailVerification(false);
    if (isLoginSubmitting) return;
    setIsLoginSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
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
        setErrorMessage(payload?.error ?? "Login failed.");
        setRequiresEmailVerification(payload?.requiresEmailVerification === true);
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

      const target = resolveLoginRedirectTarget(redirectTo, userForRedirect);
      window.location.replace(toLocaleHref(target));
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(payload.error ?? "Failed to resend verification email.");
        return;
      }
      setStatusMessage(
        payload.message ??
          (isAr
            ? "إذا كان الحساب موجودًا وغير موثق، تم إرسال رسالة تحقق جديدة."
            : "If the account exists and is unverified, a new verification email has been sent."),
      );
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResendVerificationSubmitting(false);
    }
  }

  async function handleResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    if (isResetRequestSubmitting) return;
    setIsResetRequestSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetRequestEmail }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Failed to request reset.");
        return;
      }
      setStatusMessage(data.message ?? (isAr ? "إذا كان الحساب موجودًا، تم إرسال بريد إعادة تعيين كلمة المرور." : "If the account exists, a password reset email has been sent."));
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResetRequestSubmitting(false);
    }
  }

  return (
    <section className="section-container py-8 md:py-12">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-[#070707]/95 shadow-[0_32px_90px_rgba(0,0,0,0.55)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden overflow-hidden border-r border-white/10 bg-[radial-gradient(circle_at_22%_20%,rgba(201,162,39,0.2),transparent_34%),radial-gradient(circle_at_80%_22%,rgba(147,197,253,0.16),transparent_28%),linear-gradient(160deg,#050505,#0b0b0b_52%,#111827)] p-10 lg:flex lg:flex-col">
          <div className="absolute inset-0 opacity-40">
            <div className="absolute left-14 top-16 h-40 w-40 rounded-full bg-[#C9A227]/10 blur-3xl" />
            <div className="absolute right-14 top-28 h-32 w-32 rounded-full bg-[#93C5FD]/10 blur-3xl" />
            <div className="absolute bottom-16 left-20 h-48 w-48 rounded-full bg-[#C9A227]/8 blur-3xl" />
          </div>
          <div className="relative z-10">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#D4AF37]">
              Alpha Traders
            </p>
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
                {item}
              </div>
            ))}
          </div>
          <div className="relative z-10 mt-auto grid gap-3 pt-8">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "لوحة التداول" : "Trading Workspace"}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-[#9CA3AF]">USDT / ILS</p>
                  <p className="mt-1 text-lg font-semibold text-white">LIVE</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "أمان الحساب" : "Account Security"}</p>
                  <p className="mt-1 text-lg font-semibold text-white">24/7</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative p-6 sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(201,162,39,0.08),transparent_36%)]" />
          <div className="relative z-10 mx-auto w-full max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#9CA3AF]">
              {isAr ? "تجربة دخول مميزة" : "Premium Sign In"}
            </p>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white md:text-4xl">{isAr ? "تسجيل الدخول" : "Login"}</h1>
            <p className="mt-3 max-w-lg text-sm leading-7 text-[#9CA3AF]">
              {isAr ? "أنشئ حساب Alpha Traders للوصول إلى Alpha Academy و Alpha Exchange." : "Create your Alpha Traders account to access Alpha Academy and Alpha Exchange."}
            </p>

            <div className="mt-6 grid gap-3 rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/8 p-4 text-sm text-[#E5E7EB] sm:grid-cols-2">
              {(isAr
                ? ["حفظ تقدّمك في الأكاديمية", "الوصول إلى دوراتك", "شراء وبيع USDT بأمان", "استلام الإشعارات", "بناء ملفك كمتداول", "تتبّع رحلتك في التداول"]
                : ["Save Academy progress", "Access your courses", "Buy & sell USDT securely", "Receive notifications", "Build your trader profile", "Track your trading journey"]
              ).map((item) => (
                <div key={item} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">{item}</div>
              ))}
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleLoginSubmit} data-hydrated={hydrated ? "true" : "false"}>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "البريد الإلكتروني" : "Email"}</label>
                <Input aria-label={isAr ? "البريد الإلكتروني" : "Email"} placeholder={isAr ? "you@example.com" : "you@example.com"} type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} className="h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-[#6B7280] focus-visible:border-[#C9A227]" />
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "كلمة المرور" : "Password"}</label>
                <Input aria-label={isAr ? "كلمة المرور" : "Password"} placeholder={isAr ? "••••••••" : "••••••••"} type="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} className="h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-[#6B7280] focus-visible:border-[#C9A227]" />
              </div>
              <div className={`flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
                <label className={`inline-flex items-center gap-2 text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
                  <input type="checkbox" checked={form.rememberMe} onChange={(event) => setForm((prev) => ({ ...prev, rememberMe: event.target.checked }))} className="h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227]" />
                  {isAr ? "تذكرني" : "Remember Me"}
                </label>
                <button type="button" onClick={() => setResetMode((prev) => !prev)} className="text-[#C9A227] transition hover:text-[#F4D87A] hover:underline">
                  {isAr ? "نسيت كلمة المرور" : "Forgot Password"}
                </button>
              </div>
              <Button type="submit" className="h-12 text-base" loading={isLoginSubmitting} loadingLabel={isAr ? "جاري تسجيل الدخول..." : "Logging in..."}>
                {isAr ? "تسجيل الدخول" : "Login"}
              </Button>
            </form>

            {resetMode ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/25 p-4">
                <form className="grid gap-3" onSubmit={handleResetRequest}>
                  <Input aria-label={isAr ? "البريد لإعادة تعيين كلمة المرور" : "Email for password reset"} placeholder={isAr ? "البريد لإعادة تعيين كلمة المرور" : "Email for password reset"} type="email" autoComplete="email" required value={resetRequestEmail} onChange={(event) => setResetRequestEmail(event.target.value)} className="h-12 rounded-2xl border-white/15 bg-black/30 text-white placeholder:text-[#6B7280]" />
                  <Button type="submit" variant="secondary" className="h-11" loading={isResetRequestSubmitting} loadingLabel={isAr ? "جاري الإرسال..." : "Sending..."}>
                    {isAr ? "إرسال رابط إعادة التعيين" : "Send Reset Link"}
                  </Button>
                </form>
              </div>
            ) : null}

            {errorMessage ? <p className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="status" aria-live="polite">{errorMessage}</p> : null}
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
            {statusMessage ? <p className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200" role="status" aria-live="polite">{statusMessage}</p> : null}

            <p className="mt-6 text-sm text-[#9CA3AF]">
              {isAr ? "ليس لديك حساب؟" : "Don’t have an account?"}{" "}
              <Link href="/register" className="text-[#C9A227] transition hover:text-[#F4D87A] hover:underline">
                {isAr ? "أنشئ حسابًا" : "Create Account"}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
