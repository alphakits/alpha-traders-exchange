"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash") ?? "";
  const tokenType = searchParams.get("type") ?? "recovery";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasToken = useMemo(() => Boolean(tokenHash.trim()), [tokenHash]);

  function localizeResetError(message?: string) {
    const normalized = String(message ?? "").toLowerCase();
    if (normalized.includes("invalid") || normalized.includes("expired")) {
      return isAr
        ? "رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا."
        : "This reset link is invalid or expired. Request a new password reset link.";
    }
    if (normalized.includes("match")) {
      return isAr ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.";
    }
    if (normalized.includes("at least 8")) {
      return isAr ? "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل." : "Password must be at least 8 characters.";
    }
    return isAr ? "تعذر تحديث كلمة المرور." : "Unable to update password.";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (isSubmitting || !hasToken) return;
    if (password.length < 8) {
      setErrorMessage(isAr ? "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل." : "Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(isAr ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenHash,
          type: tokenType,
          password,
          confirmPassword,
          locale,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(localizeResetError(payload.error));
        return;
      }
      setPassword("");
      setConfirmPassword("");
      window.location.replace(`/${locale}/login?reset=success`);
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "إعادة تعيين كلمة المرور" : "Reset Password"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr
            ? "أنشئ كلمة مرور جديدة وآمنة لحسابك."
            : "Create a new secure password for your account."}
        </p>

        {!hasToken ? (
          <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            {isAr
              ? "رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا."
              : "This reset link is invalid or expired. Request a new password reset link."}
          </div>
        ) : (
          <form className="mt-6 grid gap-3" onSubmit={handleSubmit}>
            <Input
              aria-label={isAr ? "كلمة المرور الجديدة" : "New Password"}
              placeholder={isAr ? "كلمة المرور الجديدة" : "New Password"}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Input
              aria-label={isAr ? "تأكيد كلمة المرور الجديدة" : "Confirm New Password"}
              placeholder={isAr ? "تأكيد كلمة المرور الجديدة" : "Confirm New Password"}
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (isAr ? "جارٍ التحديث..." : "Updating...") : (isAr ? "تحديث كلمة المرور" : "Update Password")}
            </Button>
          </form>
        )}

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}
        <p className="mt-5 text-sm text-[#9CA3AF]">
          <Link href="/forgot-password" className="text-[#C9A227] hover:underline">
            {isAr ? "طلب رابط جديد" : "Request a new reset link"}
          </Link>
        </p>
      </div>
    </section>
  );
}
