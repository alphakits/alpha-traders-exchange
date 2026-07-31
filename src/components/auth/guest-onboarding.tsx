"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POST_ONBOARDING_KEY = "post_onboarding_redirect";

function consumePostOnboardingRedirect(): string | null {
  try {
    const stored = sessionStorage.getItem(POST_ONBOARDING_KEY);
    if (stored) sessionStorage.removeItem(POST_ONBOARDING_KEY);
    return stored || null;
  } catch {
    return null;
  }
}

type Props = {
  locale: "ar" | "en";
};

export function GuestOnboarding({ locale }: Props) {
  const router = useRouter();
  const isAr = locale === "ar";
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "student" | "sendOtp" | "verifyOtp" | "skip">(null);
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", displayName: "", phone: "", token: "" });

  async function becomeStudent() {
    setLoading("student");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/student", { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to enable student role.");
      router.replace((consumePostOnboardingRedirect() ?? "/academy") as "/academy");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable student role.");
    } finally {
      setLoading(null);
    }
  }

  async function sendOtp() {
    setLoading("sendOtp");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buyer),
      });
      const payload = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to send verification code.");
      setStatus(payload.message ?? "Verification code sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setLoading(null);
    }
  }

  async function verifyOtp() {
    setLoading("verifyOtp");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: buyer.phone, token: buyer.token }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Verification failed.");
      router.replace((consumePostOnboardingRedirect() ?? "/usdt-exchange") as "/usdt-exchange");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(null);
    }
  }

  async function skip() {
    setLoading("skip");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/guest", { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to continue as guest.");
      router.replace((consumePostOnboardingRedirect() ?? "/usdt-exchange") as "/usdt-exchange");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to continue as guest.");
      setLoading(null);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-4xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "مرحبًا بك في Alpha Traders" : "Welcome to Alpha Traders"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr ? "اختر كيف تريد البدء في المنصة." : "Choose how you want to get started."}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "💵 كن مشتريًا" : "💵 Become a Buyer"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr ? "اشترِ USDT من بائعين موثوقين في Alpha Traders." : "Buy USDT from verified Alpha Traders sellers."}
            </p>
            <div className="mt-3 grid gap-2">
              <Input aria-label={isAr ? "الاسم الأول" : "First Name"} placeholder={isAr ? "الاسم الأول" : "First Name"} value={buyer.firstName} onChange={(event) => setBuyer((prev) => ({ ...prev, firstName: event.target.value }))} />
              <Input aria-label={isAr ? "اسم العائلة" : "Last Name"} placeholder={isAr ? "اسم العائلة" : "Last Name"} value={buyer.lastName} onChange={(event) => setBuyer((prev) => ({ ...prev, lastName: event.target.value }))} />
              <Input aria-label={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"} placeholder={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"} value={buyer.displayName} onChange={(event) => setBuyer((prev) => ({ ...prev, displayName: event.target.value }))} />
              <Input aria-label={isAr ? "رقم الهاتف الإسرائيلي" : "Israeli mobile number"} placeholder={isAr ? "رقم الهاتف الإسرائيلي (+972 / 05...)" : "Israeli mobile (+972 / 05...)"} value={buyer.phone} onChange={(event) => setBuyer((prev) => ({ ...prev, phone: event.target.value }))} />
              <Button type="button" onClick={sendOtp} disabled={loading !== null}>
                {loading === "sendOtp" ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
              </Button>
              <Input aria-label={isAr ? "رمز التحقق المكون من 6 أرقام" : "6-digit verification code"} placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"} value={buyer.token} onChange={(event) => setBuyer((prev) => ({ ...prev, token: event.target.value }))} />
              <Button type="button" variant="secondary" onClick={verifyOtp} disabled={loading !== null}>
                {loading === "verifyOtp" ? (isAr ? "جارٍ التحقق..." : "Verifying...") : (isAr ? "تأكيد وفتح دور المشتري" : "Verify and activate Buyer")}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "🎓 انضم إلى الأكاديمية" : "🎓 Join Alpha Academy"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr ? "الوصول إلى الفيديوهات وملفات PDF والاختبارات وتتبع التقدم." : "Access videos, PDFs, quizzes, progress tracking and trading education."}
            </p>
            <Button type="button" className="mt-4" onClick={becomeStudent} disabled={loading !== null}>
              {loading === "student" ? (isAr ? "جارٍ التفعيل..." : "Activating...") : (isAr ? "تفعيل دور الطالب" : "Become a Student")}
            </Button>
          </div>

          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "🧭 المتابعة كضيف" : "🧭 Continue as Guest"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr ? "استكشف المنصة الآن واختر دورك لاحقًا من الملف الشخصي." : "Explore the platform now and choose your role later from Profile."}
            </p>
            <Button type="button" variant="secondary" className="mt-4" onClick={() => void skip()} disabled={loading !== null}>
              {loading === "skip" ? (isAr ? "جاري المتابعة..." : "Continuing...") : (isAr ? "المتابعة كضيف" : "Continue as Guest")}
            </Button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{error}</p> : null}
        {status ? <p className="mt-3 text-sm text-emerald-300" role="status" aria-live="polite">{status}</p> : null}
      </div>
    </section>
  );
}
