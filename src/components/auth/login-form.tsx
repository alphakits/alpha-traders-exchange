"use client";

import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const router = useRouter();
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

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    if (isLoginSubmitting) return;
    setIsLoginSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Login failed.");
        return;
      }
      router.push("/usdt-exchange");
    } finally {
      setIsLoginSubmitting(false);
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
    } finally {
      setIsResetConfirmSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8">
        <h1 className="text-3xl font-semibold md:text-4xl">{isAr ? "تسجيل الدخول" : "Login"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "سجّل الدخول للوصول إلى تجربة Alpha Exchange." : "Sign in to access the Alpha Exchange experience."}</p>

        <form className="mt-6 grid gap-3" onSubmit={handleLoginSubmit}>
          <Input placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <Input placeholder={isAr ? "كلمة المرور" : "Password"} type="password" autoComplete="current-password" required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
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
              <Input placeholder={isAr ? "البريد لإرسال رمز الاستعادة" : "Email for reset token"} type="email" autoComplete="email" required value={resetRequestEmail} onChange={(event) => setResetRequestEmail(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={isResetRequestSubmitting}>{isResetRequestSubmitting ? (isAr ? "جاري الإرسال..." : "Sending...") : (isAr ? "إرسال رمز الاستعادة" : "Request Reset Token")}</Button>
            </form>
            <form className="grid gap-2" onSubmit={handleResetConfirm}>
              <Input placeholder={isAr ? "رمز الاستعادة" : "Reset Token"} required value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
              <Input placeholder={isAr ? "كلمة المرور الجديدة" : "New Password"} type="password" autoComplete="new-password" required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
              <Input placeholder={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} type="password" autoComplete="new-password" required value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} />
              <Button type="submit" variant="secondary" disabled={isResetConfirmSubmitting}>{isResetConfirmSubmitting ? (isAr ? "جاري التحديث..." : "Updating...") : (isAr ? "تحديث كلمة المرور" : "Reset Password")}</Button>
            </form>
          </div>
        ) : null}

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
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
