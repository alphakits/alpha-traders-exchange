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
    const isOwnerOrAdmin = roles.includes("owner") || roles.includes("admin") || user?.role === "owner" || user?.role === "admin";
    if (isOwnerOrAdmin) return "/admin/alpha-exchange";
    const hasOnboardingChoice = Boolean(user?.onboardingSelection || user?.onboardingCompletedAt);
    if (!hasOnboardingChoice && ((roles.length === 1 && roles[0] === "guest") || (roles.length === 0 && user?.role === "guest"))) return "/onboarding";
    if (!isOwnerOrAdmin && user?.sellerStatus === "approved_seller") return "/dashboard/seller";
    return "/usdt-exchange";
  };

  function resolveLoginRedirectTarget(
    rawRedirect: string | undefined,
    user: { role?: string; roles?: string[]; sellerStatus?: string; onboardingSelection?: string; onboardingCompletedAt?: string } | null | undefined,
  ) {
    const fallback = defaultRedirectByRole(user);
    const roles = user?.roles ?? [];
    const needsOnboarding = !user?.onboardingSelection && !user?.onboardingCompletedAt && ((roles.length === 1 && roles[0] === "guest") || user?.role === "guest");
    if (needsOnboarding) return "/onboarding";
    if (!rawRedirect) return fallback;
    if (!rawRedirect.startsWith("/") || rawRedirect.startsWith("//")) return fallback;
    if (rawRedirect === `/${locale}`) return "/";
    if (rawRedirect.startsWith(`/${locale}/`)) {
      const localePath = rawRedirect.slice(`/${locale}`.length);
      return localePath || "/";
    }
    if (/^\/(ar|en)\/(?:login|register)(?:\/|$)/.test(rawRedirect)) return fallback;
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
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "تسجيل الدخول" : "Login"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr ? "أنشئ حساب Alpha Traders للوصول إلى Alpha Academy و Alpha Exchange." : "Create your Alpha Traders account to access Alpha Academy and Alpha Exchange."}
        </p>
        <ul className="mt-4 grid gap-1 text-sm text-[#D1D5DB]">
          {isAr ? (
            <>
              <li>• حفظ تقدّمك في الأكاديمية</li>
              <li>• الوصول إلى دوراتك</li>
              <li>• شراء وبيع USDT بأمان</li>
              <li>• استلام الإشعارات</li>
              <li>• بناء ملفك كمتداول</li>
              <li>• تتبّع رحلتك في التداول</li>
            </>
          ) : (
            <>
              <li>• Save Academy progress</li>
              <li>• Access your courses</li>
              <li>• Buy &amp; sell USDT securely</li>
              <li>• Receive notifications</li>
              <li>• Build your trader profile</li>
              <li>• Track your trading journey</li>
            </>
          )}
        </ul>

        <form className="mt-6 grid gap-3" onSubmit={handleLoginSubmit} data-hydrated={hydrated ? "true" : "false"}>
          <Input aria-label={isAr ? "البريد الإلكتروني" : "Email"} placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <Input aria-label={isAr ? "كلمة المرور" : "Password"} placeholder={isAr ? "كلمة المرور" : "Password"} type="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          <div className={`flex items-center justify-between text-sm ${isAr ? "flex-row-reverse" : ""}`}>
            <label className={`inline-flex items-center gap-2 text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
              <input type="checkbox" checked={form.rememberMe} onChange={(event) => setForm((prev) => ({ ...prev, rememberMe: event.target.checked }))} className="h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227]" />
              {isAr ? "تذكرني" : "Remember Me"}
            </label>
            <button type="button" onClick={() => setResetMode((prev) => !prev)} className="text-[#C9A227] hover:underline">
              {isAr ? "نسيت كلمة المرور" : "Forgot Password"}
            </button>
          </div>
          <Button type="submit" disabled={isLoginSubmitting}>{isLoginSubmitting ? (isAr ? "جاري تسجيل الدخول..." : "Logging in...") : (isAr ? "تسجيل الدخول" : "Login")}</Button>
        </form>

        {resetMode ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <form className="grid gap-2" onSubmit={handleResetRequest}>
              <Input aria-label={isAr ? "البريد لإعادة تعيين كلمة المرور" : "Email for password reset"} placeholder={isAr ? "البريد لإعادة تعيين كلمة المرور" : "Email for password reset"} type="email" autoComplete="email" required value={resetRequestEmail} onChange={(event) => setResetRequestEmail(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={isResetRequestSubmitting}>{isResetRequestSubmitting ? (isAr ? "جاري الإرسال..." : "Sending...") : (isAr ? "إرسال رابط إعادة التعيين" : "Send Reset Link")}</Button>
            </form>
          </div>
        ) : null}

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
        {requiresEmailVerification ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            disabled={isResendVerificationSubmitting}
            onClick={handleResendVerification}
          >
            {isResendVerificationSubmitting
              ? (isAr ? "جارٍ الإرسال..." : "Sending...")
              : (isAr ? "إعادة إرسال بريد التحقق" : "Resend verification email")}
          </Button>
        ) : null}
        {statusMessage ? <p className="mt-3 text-sm text-emerald-300" role="status" aria-live="polite">{statusMessage}</p> : null}

        <p className="mt-5 text-sm text-[#9CA3AF]">
          {isAr ? "ليس لديك حساب؟" : "Don’t have an account?"}{" "}
          <Link href="/register" className="text-[#C9A227] hover:underline">
            {isAr ? "أنشئ حسابًا" : "Create Account"}
          </Link>
        </p>
      </div>
    </section>
  );
}
