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

const SUPPORTED_NETWORKS = ["TRC20", "ERC20", "BEP20", "SOL"] as const;
type Network = (typeof SUPPORTED_NETWORKS)[number];

type Props = {
  locale: "ar" | "en";
  isBuyer?: boolean;
  sellerStatus?: string;
};

export function GuestOnboarding({ locale, isBuyer = false, sellerStatus }: Props) {
  const router = useRouter();
  const isAr = locale === "ar";
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "student" | "sendOtp" | "verifyOtp" | "skip" | "seller_sendOtp" | "seller_verify" | "seller_apply">(null);
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", displayName: "", phone: "", token: "" });
  const [seller, setSeller] = useState({ firstName: "", lastName: "", displayName: "", phone: "", token: "", preferredNetworks: [] as Network[], expectedVolume: "", notes: "" });
  const [sellerStep, setSellerStep] = useState<"idle" | "otp_sent" | "applied">("idle");
  const [sellerError, setSellerError] = useState<string | null>(null);
  const [sellerStatus2, setSellerStatus2] = useState<string | null>(null);

  function toggleNetwork(net: Network) {
    setSeller((prev) => ({
      ...prev,
      preferredNetworks: prev.preferredNetworks.includes(net)
        ? prev.preferredNetworks.filter((n) => n !== net)
        : [...prev.preferredNetworks, net],
    }));
  }

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

  async function sellerSendOtp() {
    setLoading("seller_sendOtp");
    setSellerError(null);
    setSellerStatus2(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: seller.firstName, lastName: seller.lastName, displayName: seller.displayName, phone: seller.phone }),
      });
      const payload = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to send verification code.");
      setSellerStep("otp_sent");
      setSellerStatus2(payload.message ?? "Verification code sent.");
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setLoading(null);
    }
  }

  async function sellerVerifyAndApply() {
    setLoading("seller_verify");
    setSellerError(null);
    setSellerStatus2(null);
    try {
      // Step 1: verify OTP → becomes buyer
      const verifyRes = await fetch("/api/auth/onboarding/buyer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: seller.phone, token: seller.token }),
      });
      const verifyPayload = (await verifyRes.json()) as { error?: string };
      if (!verifyRes.ok) throw new Error(verifyPayload.error ?? "Verification failed.");

      // Step 2: submit seller application
      await submitSellerApplication();
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : "Verification failed.");
      setLoading(null);
    }
  }

  async function submitSellerApplication() {
    setLoading("seller_apply");
    setSellerError(null);
    try {
      const res = await fetch("/api/alpha-exchange/seller-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: isBuyer ? undefined : `${seller.firstName} ${seller.lastName}`.trim() || undefined,
          whatsappNumber: isBuyer ? undefined : seller.phone || undefined,
          preferredNetworks: seller.preferredNetworks,
          expectedMonthlyTradingVolume: seller.expectedVolume,
          additionalNotes: seller.notes,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to submit seller application.");
      setSellerStep("applied");
      consumePostOnboardingRedirect();
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : "Failed to submit seller application.");
    } finally {
      setLoading(null);
    }
  }

  const isLoading = loading !== null;

  const sellerCardContent = () => {
    if (sellerStatus === "approved_seller") {
      return (
        <p className="mt-3 text-sm text-emerald-300">
          {isAr ? "✅ أنت بائع معتمد بالفعل." : "✅ You are already an approved seller."}
        </p>
      );
    }
    if (sellerStatus === "pending_seller_approval" || sellerStep === "applied") {
      return (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium text-amber-300">
            {isAr ? "⏳ طلبك قيد المراجعة" : "⏳ Application Under Review"}
          </p>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            {isAr
              ? "سيقوم المسؤول بمراجعة طلبك وإخطارك قريبًا."
              : "The admin will review your application and notify you soon."}
          </p>
          {sellerStep === "applied" && (
            <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => router.replace("/usdt-exchange")}>
              {isAr ? "متابعة إلى Exchange" : "Continue to Exchange"}
            </Button>
          )}
        </div>
      );
    }

    if (isBuyer) {
      // Already a buyer — skip OTP, just show seller application form
      return (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-[#9CA3AF]">
            {isAr ? "اختر الشبكات التي تفضل التداول بها:" : "Select your preferred trading networks:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_NETWORKS.map((net) => (
              <button
                key={net}
                type="button"
                onClick={() => toggleNetwork(net)}
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                  seller.preferredNetworks.includes(net)
                    ? "border-[#C9A227] bg-[#C9A227]/20 text-[#C9A227]"
                    : "border-[#374151] bg-black/20 text-[#9CA3AF] hover:border-[#C9A227]/50"
                }`}
              >
                {net}
              </button>
            ))}
          </div>
          <Input
            aria-label={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
            placeholder={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
            value={seller.expectedVolume}
            onChange={(e) => setSeller((p) => ({ ...p, expectedVolume: e.target.value }))}
          />
          <Input
            aria-label={isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"}
            placeholder={isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"}
            value={seller.notes}
            onChange={(e) => setSeller((p) => ({ ...p, notes: e.target.value }))}
          />
          <Button type="button" onClick={() => void submitSellerApplication()} disabled={isLoading || seller.preferredNetworks.length === 0}>
            {loading === "seller_apply" ? (isAr ? "جارٍ الإرسال..." : "Submitting...") : (isAr ? "تقديم طلب البائع" : "Submit Seller Application")}
          </Button>
        </div>
      );
    }

    if (sellerStep === "otp_sent") {
      return (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-emerald-300">{sellerStatus2}</p>
          <p className="text-xs text-[#9CA3AF]">
            {isAr ? "اختر الشبكات التي تفضل التداول بها:" : "Select your preferred trading networks:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_NETWORKS.map((net) => (
              <button
                key={net}
                type="button"
                onClick={() => toggleNetwork(net)}
                className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                  seller.preferredNetworks.includes(net)
                    ? "border-[#C9A227] bg-[#C9A227]/20 text-[#C9A227]"
                    : "border-[#374151] bg-black/20 text-[#9CA3AF] hover:border-[#C9A227]/50"
                }`}
              >
                {net}
              </button>
            ))}
          </div>
          <Input
            aria-label={isAr ? "رمز التحقق المكون من 6 أرقام" : "6-digit verification code"}
            placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
            value={seller.token}
            onChange={(e) => setSeller((p) => ({ ...p, token: e.target.value }))}
          />
          <Button type="button" onClick={() => void sellerVerifyAndApply()} disabled={isLoading || seller.preferredNetworks.length === 0 || seller.token.length !== 6}>
            {loading === "seller_verify" || loading === "seller_apply" ? (isAr ? "جارٍ التحقق..." : "Verifying...") : (isAr ? "تحقق وتقديم الطلب" : "Verify & Submit Application")}
          </Button>
          <button type="button" className="text-xs text-[#9CA3AF] underline" onClick={() => setSellerStep("idle")} disabled={isLoading}>
            {isAr ? "تعديل البيانات" : "Edit details"}
          </button>
        </div>
      );
    }

    // idle: show full form
    return (
      <div className="mt-3 grid gap-2">
        <Input aria-label={isAr ? "الاسم الأول" : "First Name"} placeholder={isAr ? "الاسم الأول" : "First Name"} value={seller.firstName} onChange={(e) => setSeller((p) => ({ ...p, firstName: e.target.value }))} />
        <Input aria-label={isAr ? "اسم العائلة" : "Last Name"} placeholder={isAr ? "اسم العائلة" : "Last Name"} value={seller.lastName} onChange={(e) => setSeller((p) => ({ ...p, lastName: e.target.value }))} />
        <Input aria-label={isAr ? "رقم واتساب (+972 / 05...)" : "WhatsApp number (+972 / 05...)"} placeholder={isAr ? "رقم واتساب (+972 / 05...)" : "WhatsApp (+972 / 05...)"} value={seller.phone} onChange={(e) => setSeller((p) => ({ ...p, phone: e.target.value }))} />
        <p className="text-xs text-[#9CA3AF]">
          {isAr ? "الشبكات المفضلة للتداول:" : "Preferred trading networks:"}
        </p>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_NETWORKS.map((net) => (
            <button
              key={net}
              type="button"
              onClick={() => toggleNetwork(net)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                seller.preferredNetworks.includes(net)
                  ? "border-[#C9A227] bg-[#C9A227]/20 text-[#C9A227]"
                  : "border-[#374151] bg-black/20 text-[#9CA3AF] hover:border-[#C9A227]/50"
              }`}
            >
              {net}
            </button>
          ))}
        </div>
        <Input
          aria-label={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
          placeholder={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
          value={seller.expectedVolume}
          onChange={(e) => setSeller((p) => ({ ...p, expectedVolume: e.target.value }))}
        />
        <Button type="button" onClick={() => void sellerSendOtp()} disabled={isLoading || !seller.firstName || !seller.lastName || !seller.phone || seller.preferredNetworks.length === 0}>
          {loading === "seller_sendOtp" ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
        </Button>
      </div>
    );
  };

  return (
    <section className="section-container page-shell">
      <div className="surface-panel mx-auto w-full max-w-5xl p-6 md:p-8">
        <h1 className="page-title">{isAr ? "مرحبًا بك في Alpha Traders" : "Welcome to Alpha Traders"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr ? "اختر كيف تريد البدء في المنصة." : "Choose how you want to get started."}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Become a Buyer */}
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
              <Button type="button" onClick={sendOtp} disabled={isLoading}>
                {loading === "sendOtp" ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
              </Button>
              <Input aria-label={isAr ? "رمز التحقق المكون من 6 أرقام" : "6-digit verification code"} placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"} value={buyer.token} onChange={(event) => setBuyer((prev) => ({ ...prev, token: event.target.value }))} />
              <Button type="button" variant="secondary" onClick={verifyOtp} disabled={isLoading}>
                {loading === "verifyOtp" ? (isAr ? "جارٍ التحقق..." : "Verifying...") : (isAr ? "تأكيد وفتح دور المشتري" : "Verify and activate Buyer")}
              </Button>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-300" role="status" aria-live="polite">{error}</p> : null}
            {status ? <p className="mt-2 text-xs text-emerald-300" role="status" aria-live="polite">{status}</p> : null}
          </div>

          {/* Apply for Seller Status */}
          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "🏪 التقدم كبائع" : "🏪 Apply for Seller Status"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr
                ? "بِع USDT لمشترين موثوقين. يتطلب موافقة المسؤول."
                : "Sell USDT to verified buyers. Requires admin approval."}
            </p>
            {sellerCardContent()}
            {sellerError ? <p className="mt-2 text-xs text-rose-300" role="status" aria-live="polite">{sellerError}</p> : null}
          </div>

          {/* Join Alpha Academy */}
          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "🎓 انضم إلى الأكاديمية" : "🎓 Join Alpha Academy"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr ? "الوصول إلى الفيديوهات وملفات PDF والاختبارات وتتبع التقدم." : "Access videos, PDFs, quizzes, progress tracking and trading education."}
            </p>
            <Button type="button" className="mt-4" onClick={becomeStudent} disabled={isLoading}>
              {loading === "student" ? (isAr ? "جارٍ التفعيل..." : "Activating...") : (isAr ? "تفعيل دور الطالب" : "Become a Student")}
            </Button>
          </div>

          {/* Continue as Guest */}
          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <h2 className="text-xl font-semibold">{isAr ? "🧭 المتابعة كضيف" : "🧭 Continue as Guest"}</h2>
            <p className="mt-2 text-sm text-[#D1D5DB]">
              {isAr ? "استكشف المنصة الآن واختر دورك لاحقًا من الملف الشخصي." : "Explore the platform now and choose your role later from Profile."}
            </p>
            <Button type="button" variant="secondary" className="mt-4" onClick={() => void skip()} disabled={isLoading}>
              {loading === "skip" ? (isAr ? "جاري المتابعة..." : "Continuing...") : (isAr ? "المتابعة كضيف" : "Continue as Guest")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
