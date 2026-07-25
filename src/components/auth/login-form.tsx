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
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [isResetRequestSubmitting, setIsResetRequestSubmitting] = useState(false);
  const [isResetConfirmSubmitting, setIsResetConfirmSubmitting] = useState(false);
  const [isResendVerificationSubmitting, setIsResendVerificationSubmitting] = useState(false);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const defaultRedirectByRole = (user: { role?: string; sellerStatus?: string } | null | undefined) => {
    if (user?.role === "admin") return "/admin/alpha-exchange";
    if (user?.role !== "admin" && user?.sellerStatus === "approved_seller") return "/dashboard/seller";
    return "/usdt-exchange";
  };

  function resolveLoginRedirectTarget(rawRedirect?: string) {
    const fallback = defaultRedirectByRole(undefined);
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
      let payload: { error?: string; user?: { role?: string; sellerStatus?: string }; requiresEmailVerification?: boolean } | null = null;
      try {
        payload = (await response.json()) as { error?: string; user?: { role?: string; sellerStatus?: string }; requiresEmailVerification?: boolean };
      } catch {
        payload = null;
      }
      if (!response.ok) {
        setErrorMessage(payload?.error ?? "Login failed.");
        setRequiresEmailVerification(payload?.requiresEmailVerification === true);
        return;
      }
      // Ensure the freshly set httpOnly session cookie is visible to subsequent
      // requests before navigating to a protected route.
      let sessionReady = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const meResponse = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { "Cache-Control": "no-store" },
        });
        if (meResponse.ok) {
          const mePayload = (await meResponse.json()) as { user?: { id?: string } | null };
          if (mePayload?.user?.id) {
            sessionReady = true;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!sessionReady) {
        setErrorMessage(
          isAr
            ? "تم تسجيل الدخول ولكن تعذر تأكيد الجلسة. حاول مرة أخرى."
            : "Logged in, but we couldn't confirm your session. Please try again.",
        );
        return;
      }

      const target = redirectTo ? resolveLoginRedirectTarget(redirectTo) : defaultRedirectByRole(payload?.user);
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
      console.info("[login-form] resend verification requested", {
        endpoint: "/api/auth/verify-email/resend",
        email: form.email,
      });
      const response = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      console.info("[login-form] resend verification response", {
        status: response.status,
        ok: response.ok,
        payload,
      });
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
    } catch (error) {
      console.error("[login-form] resend verification fetch failed", error);
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
      const data = (await response.json()) as { error?: string; resetToken?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Failed to request reset.");
        return;
      }
      if (data.resetToken) {
        setStatusMessage((isAr ? "تم إنشاء رمز إعادة التعيين: " : "Reset token created: ") + data.resetToken);
      } else {
        setStatusMessage(isAr ? "إذا كان البريد مسجلاً فسيتم إنشاء رمز إعادة التعيين." : "If the email exists, a reset token has been generated.");
      }
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResetRequestSubmitting(false);
    }
  }

  async function handleResetConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    if (isResetConfirmSubmitting) return;
    setIsResetConfirmSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          password: resetPassword,
          confirmPassword: resetConfirm,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Failed to reset password.");
        return;
      }
      setStatusMessage(isAr ? "تم تحديث كلمة المرور بنجاح." : "Password updated successfully.");
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsResetConfirmSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8">
        <h1 className="text-3xl font-semibold md:text-4xl">{isAr ? "تسجيل الدخول" : "Login"}</h1>
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
              <Input aria-label={isAr ? "البريد لإرسال رمز الاستعادة" : "Email for reset token"} placeholder={isAr ? "البريد لإرسال رمز الاستعادة" : "Email for reset token"} type="email" autoComplete="email" required value={resetRequestEmail} onChange={(event) => setResetRequestEmail(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={isResetRequestSubmitting}>{isResetRequestSubmitting ? (isAr ? "جاري الإرسال..." : "Sending...") : (isAr ? "إرسال رمز الاستعادة" : "Request Reset Token")}</Button>
            </form>
            <form className="grid gap-2" onSubmit={handleResetConfirm}>
              <Input aria-label={isAr ? "رمز الاستعادة" : "Reset Token"} placeholder={isAr ? "رمز الاستعادة" : "Reset Token"} required value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
              <Input aria-label={isAr ? "كلمة المرور الجديدة" : "New Password"} placeholder={isAr ? "كلمة المرور الجديدة" : "New Password"} type="password" autoComplete="new-password" required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
              <Input aria-label={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} placeholder={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} type="password" autoComplete="new-password" required value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={isResetConfirmSubmitting}>{isResetConfirmSubmitting ? (isAr ? "جاري التحديث..." : "Updating...") : (isAr ? "تحديث كلمة المرور" : "Reset Password")}</Button>
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
