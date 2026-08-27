"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, ShieldCheck, Store, UserCircle2, Sparkles, Clock3, CheckCircle2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { navigateAfterSuccess } from "@/lib/client-success-navigation";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POST_ONBOARDING_KEY = "post_onboarding_redirect";
const SELLER_METHOD_OPTIONS = [
  { id: "USDT (ERC20 / Ethereum)", group: "Crypto", recommended: true },
  { id: "USDT (Polygon)", group: "Crypto", recommended: false },
  { id: "USDT (Solana SPL / Phantom)", group: "Crypto", recommended: false },
  { id: "Face-to-Face", group: "Fiat", recommended: false },
  { id: "Cardless Withdrawal", group: "Fiat", recommended: false },
  { id: "Bank Transfer", group: "Fiat", recommended: false },
] as const;
type SellerMethod = (typeof SELLER_METHOD_OPTIONS)[number]["id"];

function sellerMethodLabel(method: SellerMethod, isAr: boolean) {
  if (!isAr) return method;
  if (method === "USDT (ERC20 / Ethereum)") return "USDT (ERC20 / إيثيريوم)";
  if (method === "USDT (Polygon)") return "USDT (بوليجون)";
  if (method === "USDT (Solana SPL / Phantom)") return "USDT (سولانا SPL / فانتوم)";
  if (method === "Face-to-Face") return "لقاء مباشر وجهًا لوجه";
  if (method === "Cardless Withdrawal") return "سحب من الصراف دون بطاقة";
  return "تحويل بنكي";
}

type Props = {
  locale: "ar" | "en";
  isBuyer?: boolean;
  sellerStatus?: string;
  phoneVerificationEnabled: boolean;
};

type ApiErrorPayload = {
  error?: string;
  supportCode?: string;
  requestId?: string;
  message?: string;
};

function consumePostOnboardingRedirect(): string | null {
  try {
    const stored = sessionStorage.getItem(POST_ONBOARDING_KEY);
    if (stored) sessionStorage.removeItem(POST_ONBOARDING_KEY);
    return stored || null;
  } catch {
    return null;
  }
}

type PremiumCardProps = {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  accent: "gold" | "blue" | "green" | "slate";
  children: ReactNode;
};

function PremiumCard({ title, subtitle, icon: Icon, accent, children }: PremiumCardProps) {
  const theme = accent === "gold"
    ? "from-[#C9A227]/20 to-[#7A5A14]/10 border-[#C9A227]/35"
    : accent === "blue"
      ? "from-sky-500/15 to-blue-800/10 border-sky-300/25"
      : accent === "green"
        ? "from-emerald-500/15 to-emerald-900/10 border-emerald-300/25"
        : "from-white/10 to-white/0 border-white/15";
  return (
    <motion.article
      layout
      whileHover={{ y: -2, scale: 1.002 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`rounded-2xl border bg-gradient-to-br ${theme} p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)] md:p-5`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl border border-white/15 bg-black/35 p-2 text-[#E8C547]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white md:text-xl">{title}</h2>
          <p className="mt-1 text-sm text-[#C8CDD8]">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </motion.article>
  );
}

export function GuestOnboarding({
  locale,
  isBuyer = false,
  sellerStatus,
  phoneVerificationEnabled,
}: Props) {
  const router = useRouter();
  const canonicalSession = useOptionalCanonicalSession();
  const isAr = locale === "ar";
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<null | "student" | "buyer_activate" | "skip" | "seller_sendOtp" | "seller_verify" | "seller_apply">(null);
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", displayName: "" });
  const [seller, setSeller] = useState({ firstName: "", lastName: "", displayName: "", phone: "", token: "", preferredNetworks: [] as SellerMethod[], expectedVolume: "", notes: "" });
  const [sellerStep, setSellerStep] = useState<"idle" | "otp_sent" | "applied">("idle");
  const [sellerError, setSellerError] = useState<string | null>(null);
  const [sellerStatus2, setSellerStatus2] = useState<string | null>(null);

  const isLoading = loading !== null;
  const sellerNeedsReview = sellerStatus === "pending_seller_approval" || sellerStep === "applied";
  const sellerIsApproved = sellerStatus === "approved_seller";

  const profileHint = useMemo(
    () => (isAr ? "يمكنك تعديل كل هذه الخيارات لاحقًا من الإعدادات." : "You can refine all of these settings later from your account settings."),
    [isAr],
  );

  function withSupportDetails(payload: ApiErrorPayload, fallbackEn: string, fallbackAr: string) {
    const message = isAr ? fallbackAr : (payload.error ?? fallbackEn);
    if (!payload.supportCode && !payload.requestId) return message;
    const suffix = [payload.supportCode, payload.requestId].filter(Boolean).join(" • ");
    return `${message} (${suffix})`;
  }

  function toggleNetwork(net: SellerMethod) {
    setSeller((prev) => ({
      ...prev,
      preferredNetworks: prev.preferredNetworks.includes(net)
        ? prev.preferredNetworks.filter((n) => n !== net)
        : [...prev.preferredNetworks, net],
    }));
  }

  async function refreshCanonicalSession() {
    if (canonicalSession) {
      await canonicalSession.refresh({ force: true });
      return;
    }
    window.dispatchEvent(new Event("alpha-auth-changed"));
  }

  async function becomeStudent() {
    setLoading("student");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/student", { method: "POST" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(isAr ? "تعذر تفعيل دور الطالب." : (payload.error ?? "Failed to enable student role."));
      await refreshCanonicalSession();
      router.replace((consumePostOnboardingRedirect() ?? "/academy") as "/academy");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr ? "تعذر تفعيل دور الطالب." : (detail || "Failed to enable student role."));
    } finally {
      setLoading(null);
    }
  }

  async function activateBuyerWithoutPhone() {
    setLoading("buyer_activate");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/onboarding/buyer/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          displayName: buyer.displayName,
        }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Failed to continue as buyer.", "تعذر المتابعة كمشترٍ."));
      await refreshCanonicalSession();
      router.replace((consumePostOnboardingRedirect() ?? "/usdt-exchange") as "/usdt-exchange");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr ? "تعذر المتابعة كمشترٍ." : (detail || "Failed to continue as buyer."));
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
      if (!res.ok) throw new Error(isAr ? "تعذر المتابعة كضيف." : (payload.error ?? "Failed to continue as guest."));
      await refreshCanonicalSession();
      router.replace((consumePostOnboardingRedirect() ?? "/usdt-exchange") as "/usdt-exchange");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(isAr ? "تعذر المتابعة كضيف." : (detail || "Failed to continue as guest."));
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
        body: JSON.stringify({
          firstName: seller.firstName,
          lastName: seller.lastName,
          displayName: seller.displayName,
          phone: seller.phone,
        }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Failed to send verification code.", "تعذر إرسال رمز التحقق."));
      setSellerStep("otp_sent");
      setSellerStatus2(isAr ? "تم إرسال رمز التحقق." : (payload.message ?? "Verification code sent."));
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setSellerError(isAr ? "تعذر إرسال رمز التحقق." : (detail || "Failed to send verification code."));
    } finally {
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
      const payload = (await res.json()) as { error?: string; destination?: string };
      if (!res.ok) throw new Error(isAr ? "تعذر تقديم طلب البائع." : (payload.error ?? "Failed to submit seller application."));
      setSellerStep("applied");
      await refreshCanonicalSession();
      if (!navigateAfterSuccess(router, payload.destination)) consumePostOnboardingRedirect();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setSellerError(isAr ? "تعذر تقديم طلب البائع." : (detail || "Failed to submit seller application."));
    } finally {
      setLoading(null);
    }
  }

  async function sellerVerifyAndApply() {
    setLoading("seller_verify");
    setSellerError(null);
    setSellerStatus2(null);
    try {
      const verifyRes = await fetch("/api/auth/onboarding/buyer/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: seller.phone, token: seller.token }),
      });
      const verifyPayload = (await verifyRes.json()) as ApiErrorPayload;
      if (!verifyRes.ok) throw new Error(withSupportDetails(verifyPayload, "Verification failed.", "فشل التحقق من الرمز."));
      await submitSellerApplication();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setSellerError(isAr ? "فشل التحقق من الرمز." : (detail || "Verification failed."));
      setLoading(null);
    }
  }

  async function activateBuyerAndApplySeller() {
    setLoading("seller_verify");
    setSellerError(null);
    setSellerStatus2(null);
    try {
      if (!isBuyer) {
        const buyerRes = await fetch("/api/auth/onboarding/buyer/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: seller.firstName,
            lastName: seller.lastName,
            displayName: seller.displayName,
          }),
        });
        const buyerPayload = (await buyerRes.json()) as ApiErrorPayload;
        if (!buyerRes.ok) throw new Error(withSupportDetails(buyerPayload, "Failed to activate buyer access.", "تعذر تفعيل صلاحية المشتري."));
      }
      await submitSellerApplication();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setSellerError(isAr ? "تعذر تقديم طلب البائع." : (detail || "Failed to submit seller application."));
      setLoading(null);
    }
  }

  return (
    <section className="section-container page-shell">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="surface-panel mx-auto w-full max-w-6xl p-6 md:p-8"
      >
        <div className="rounded-2xl border border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/15 via-black/25 to-black/60 p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-1 text-xs font-medium text-[#F4D87A]">
                <Sparkles className="h-3.5 w-3.5" />
                {isAr ? "تهيئة حسابك" : "Account setup"}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                {isAr ? "ابدأ رحلتك في Alpha Traders" : "Start your Alpha Traders journey"}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#CDD2DD] md:text-base">
                {isAr
                  ? "اختر المسار الذي يناسبك الآن. يمكنك ترقية دورك لاحقًا من الإعدادات بدون فقدان بياناتك."
                  : "Choose the path that fits you now. You can upgrade roles later from settings without losing your progress."}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-xs text-[#A8B0BF]">
              {profileHint}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <PremiumCard
            title={isAr ? "Become a Buyer" : "Become a Buyer"}
            subtitle={isAr
              ? "تحقق من بريدك الإلكتروني ثم فعّل وصول المشتري إلى السوق."
              : "Verify your email, then activate Buyer access to the marketplace."}
            icon={ShieldCheck}
            accent="gold"
          >
            <div className="grid gap-2">
              <Input
                aria-label={isAr ? "الاسم الأول" : "First Name"}
                placeholder={isAr ? "الاسم الأول" : "First Name"}
                value={buyer.firstName}
                onChange={(event) => setBuyer((prev) => ({ ...prev, firstName: event.target.value }))}
              />
              <Input
                aria-label={isAr ? "اسم العائلة" : "Last Name"}
                placeholder={isAr ? "اسم العائلة" : "Last Name"}
                value={buyer.lastName}
                onChange={(event) => setBuyer((prev) => ({ ...prev, lastName: event.target.value }))}
              />
              <Input
                aria-label={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"}
                placeholder={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"}
                value={buyer.displayName}
                onChange={(event) => setBuyer((prev) => ({ ...prev, displayName: event.target.value }))}
              />
              <div className="space-y-3">
                <p className="rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  {isAr
                    ? "رقم الهاتف اختياري ولا يمنع تداول المشتري."
                    : "Phone verification is optional and does not block Buyer trading."}
                </p>
                <Button
                  type="button"
                  className="h-11 w-full"
                  loading={loading === "buyer_activate"}
                  loadingLabel={isAr ? "جارٍ المتابعة..." : "Continuing..."}
                  onClick={() => void activateBuyerWithoutPhone()}
                  disabled={isLoading || !buyer.firstName.trim() || !buyer.lastName.trim()}
                >
                  {isAr ? "المتابعة كمشتري" : "Continue as Buyer"}
                </Button>
              </div>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
            {status ? <p className="mt-2 text-xs text-emerald-300">{status}</p> : null}
          </PremiumCard>

          <PremiumCard
            title={isAr ? "Apply for Seller Status" : "Apply for Seller Status"}
            subtitle={isAr ? "قدّم كبائع وابدأ بعد الموافقة الرسمية." : "Submit as a seller and start after admin approval."}
            icon={Store}
            accent="blue"
          >
            <AnimatePresence mode="wait">
              {sellerIsApproved ? (
                <motion.div
                  key="seller-approved"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm text-emerald-200"
                >
                  <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />{isAr ? "أنت بائع معتمد بالفعل." : "You are already an approved seller."}</p>
                  <Button type="button" className="mt-3 w-full" onClick={() => router.replace("/dashboard/seller")}>
                    {isAr ? "فتح لوحة البائع" : "Open seller dashboard"}
                  </Button>
                </motion.div>
              ) : sellerNeedsReview ? (
                <motion.div
                  key="seller-review"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-100"
                >
                  <p className="flex items-center gap-2 font-medium"><Clock3 className="h-4 w-4" />{isAr ? "طلبك قيد المراجعة." : "Your application is under review."}</p>
                  <p className="mt-1 text-xs text-amber-100/90">
                    {isAr ? "سيصلك إشعار فور اكتمال المراجعة." : "You’ll receive a notification as soon as review is complete."}
                  </p>
                  <Button type="button" variant="secondary" className="mt-3 w-full" onClick={() => router.replace("/usdt-exchange")}>
                    {isAr ? "متابعة إلى Exchange" : "Continue to Exchange"}
                  </Button>
                </motion.div>
              ) : isBuyer ? (
                <motion.div key="seller-buyer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</p>
                    <p className="mt-1 text-xs text-[#AEB5C2]">{isAr ? "اختر طريقة أو أكثر." : "Select one or more methods."}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(["Crypto", "Fiat"] as const).map((group) => (
                        <div key={`buyer-${group}`} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? (group === "Crypto" ? "عملات رقمية" : "عملات نقدية") : group}</p>
                          <div className="grid gap-2">
                            {SELLER_METHOD_OPTIONS.filter((option) => option.group === group).map((option) => {
                              const selected = seller.preferredNetworks.includes(option.id);
                              return (
                                <button
                                  key={`buyer-${option.id}`}
                                  type="button"
                                  onClick={() => toggleNetwork(option.id)}
                                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isAr ? "text-right" : "text-left"} ${
                                    selected
                                      ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
                                      : "border-[#374151] bg-black/20 text-[#D1D5DB] hover:border-[#C9A227]/50"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{sellerMethodLabel(option.id, isAr)}</span>
                                    {option.recommended ? <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4AF37]">⭐</span> : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Input
                    aria-label={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
                    placeholder={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
                    value={seller.expectedVolume}
                    onChange={(e) => setSeller((p) => ({ ...p, expectedVolume: e.target.value }))}
                  />
                  <Button
                    type="button"
                    loading={loading === "seller_apply"}
                    loadingLabel={isAr ? "جارٍ الإرسال..." : "Submitting..."}
                    onClick={() => void submitSellerApplication()}
                    disabled={isLoading || seller.preferredNetworks.length === 0}
                  >
                    {isAr ? "تقديم طلب البائع" : "Submit Seller Application"}
                  </Button>
                </motion.div>
              ) : sellerStep === "otp_sent" ? (
                <motion.div key="seller-otp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2">
                  {sellerStatus2 ? <p className="text-xs text-emerald-300">{sellerStatus2}</p> : null}
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(["Crypto", "Fiat"] as const).map((group) => (
                        <div key={`otp-${group}`} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? (group === "Crypto" ? "عملات رقمية" : "عملات نقدية") : group}</p>
                          <div className="grid gap-2">
                            {SELLER_METHOD_OPTIONS.filter((option) => option.group === group).map((option) => {
                              const selected = seller.preferredNetworks.includes(option.id);
                              return (
                                <button
                                  key={`otp-${option.id}`}
                                  type="button"
                                  onClick={() => toggleNetwork(option.id)}
                                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isAr ? "text-right" : "text-left"} ${
                                    selected
                                      ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
                                      : "border-[#374151] bg-black/20 text-[#D1D5DB] hover:border-[#C9A227]/50"
                                  }`}
                                >
                                  {sellerMethodLabel(option.id, isAr)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Input
                    aria-label={isAr ? "رمز التحقق المكون من 6 أرقام" : "6-digit verification code"}
                    placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                    value={seller.token}
                    onChange={(e) => setSeller((p) => ({ ...p, token: e.target.value }))}
                  />
                  <Button
                    type="button"
                    loading={loading === "seller_verify" || loading === "seller_apply"}
                    loadingLabel={isAr ? "جارٍ التحقق..." : "Verifying..."}
                    onClick={() => void sellerVerifyAndApply()}
                    disabled={isLoading || seller.preferredNetworks.length === 0 || seller.token.length !== 6}
                  >
                    {isAr ? "تحقق وتقديم الطلب" : "Verify & Submit Application"}
                  </Button>
                  <button type="button" className="text-xs text-[#9CA3AF] underline" onClick={() => setSellerStep("idle")} disabled={isLoading}>
                    {isAr ? "تعديل البيانات" : "Edit details"}
                  </button>
                </motion.div>
              ) : (
                <motion.div key="seller-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2">
                  <Input
                    aria-label={isAr ? "الاسم الأول" : "First Name"}
                    placeholder={isAr ? "الاسم الأول" : "First Name"}
                    value={seller.firstName}
                    onChange={(e) => setSeller((p) => ({ ...p, firstName: e.target.value }))}
                  />
                  <Input
                    aria-label={isAr ? "اسم العائلة" : "Last Name"}
                    placeholder={isAr ? "اسم العائلة" : "Last Name"}
                    value={seller.lastName}
                    onChange={(e) => setSeller((p) => ({ ...p, lastName: e.target.value }))}
                  />
                  <Input
                    aria-label={isAr ? "رقم واتساب (+972 / 05...)" : "WhatsApp number (+972 / 05...)"}
                    placeholder={isAr ? "رقم واتساب (+972 / 05...)" : "WhatsApp (+972 / 05...)"}
                    value={seller.phone}
                    onChange={(e) => setSeller((p) => ({ ...p, phone: e.target.value }))}
                  />
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</p>
                    <p className="mt-1 text-xs text-[#AEB5C2]">{isAr ? "اختر طريقة أو أكثر." : "Select one or more methods."}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(["Crypto", "Fiat"] as const).map((group) => (
                        <div key={`idle-${group}`} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? (group === "Crypto" ? "عملات رقمية" : "عملات نقدية") : group}</p>
                          <div className="grid gap-2">
                            {SELLER_METHOD_OPTIONS.filter((option) => option.group === group).map((option) => {
                              const selected = seller.preferredNetworks.includes(option.id);
                              return (
                                <button
                                  key={`idle-${option.id}`}
                                  type="button"
                                  onClick={() => toggleNetwork(option.id)}
                                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isAr ? "text-right" : "text-left"} ${
                                    selected
                                      ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
                                      : "border-[#374151] bg-black/20 text-[#D1D5DB] hover:border-[#C9A227]/50"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{sellerMethodLabel(option.id, isAr)}</span>
                                    {option.recommended ? <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4AF37]">⭐ {isAr ? "موصى به" : "Recommended"}</span> : null}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                    <p className="font-semibold text-white">{isAr ? "ماذا يحدث بعد التقديم؟" : "What happens after you apply?"}</p>
                    <ul className="mt-2 list-disc space-y-1 ps-5">
                      <li>{isAr ? "يدخل طلبك في مراجعة يدوية." : "Your application enters manual review."}</li>
                      <li>{isAr
                        ? (phoneVerificationEnabled
                          ? "يتواصل فريق Alpha Traders عبر WhatsApp على رقمك المحقق."
                          : "يتواصل فريق Alpha Traders عبر WhatsApp باستخدام الرقم الذي تقدمه في الطلب.")
                        : (phoneVerificationEnabled
                          ? "The Alpha Traders team contacts you via WhatsApp using your verified number."
                          : "The Alpha Traders team contacts you via WhatsApp using the number you provide in your application.")}</li>
                      <li>{isAr ? "قد نطلب معلومات إضافية قبل الموافقة." : "Additional verification may be requested before approval."}</li>
                    </ul>
                  </div>
                  <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-[#9CA3AF]">
                    {isAr
                      ? "الموافقة على البائعين تتم يدويًا لحماية المشترين والحفاظ على سوق موثوق."
                      : "Seller approval is performed manually to protect buyers and maintain a trusted marketplace."}
                  </p>
                  <Input
                    aria-label={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
                    placeholder={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
                    value={seller.expectedVolume}
                    onChange={(e) => setSeller((p) => ({ ...p, expectedVolume: e.target.value }))}
                  />
                  {phoneVerificationEnabled ? (
                    <Button
                      type="button"
                      loading={loading === "seller_sendOtp"}
                      loadingLabel={isAr ? "جارٍ الإرسال..." : "Sending..."}
                      onClick={() => void sellerSendOtp()}
                      disabled={isLoading || !seller.firstName || !seller.lastName || !seller.phone || seller.preferredNetworks.length === 0}
                    >
                      {isAr ? "إرسال رمز التحقق" : "Send verification code"}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                        {isAr
                          ? "التحقق عبر الهاتف غير متاح مؤقتًا. سنستخدم رقم WhatsApp الذي تضيفه في الطلب إلى أن يكتمل تفعيل الخدمة."
                          : "Phone verification is temporarily unavailable. We’ll use the WhatsApp number in your application until service activation is complete."}
                      </div>
                      <Button
                        type="button"
                        loading={loading === "seller_verify"}
                        loadingLabel={isAr ? "جارٍ الإرسال..." : "Submitting..."}
                        onClick={() => void activateBuyerAndApplySeller()}
                        disabled={isLoading || !seller.firstName || !seller.lastName || !seller.phone || seller.preferredNetworks.length === 0}
                      >
                        {isAr ? "إرسال طلب البائع" : "Submit Seller Application"}
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {sellerError ? <p className="mt-2 text-xs text-rose-300">{sellerError}</p> : null}
          </PremiumCard>

          <PremiumCard
            title={isAr ? "Join Alpha Academy" : "Join Alpha Academy"}
            subtitle={isAr ? "تعلم عبر فيديوهات وملفات PDF واختبارات تتبع التقدم." : "Learn through videos, PDFs, and progress-based quizzes."}
            icon={GraduationCap}
            accent="green"
          >
            <Button
              type="button"
              className="w-full"
              loading={loading === "student"}
              loadingLabel={isAr ? "جارٍ التفعيل..." : "Activating..."}
              onClick={() => void becomeStudent()}
              disabled={isLoading}
            >
              {isAr ? "تفعيل دور الطالب" : "Become a Student"}
            </Button>
          </PremiumCard>

          <PremiumCard
            title={isAr ? "Continue as Guest" : "Continue as Guest"}
            subtitle={isAr ? "استكشف الواجهة الآن وحدد دورك لاحقًا." : "Explore now and choose your role later."}
            icon={UserCircle2}
            accent="slate"
          >
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={loading === "skip"}
              loadingLabel={isAr ? "جاري المتابعة..." : "Continuing..."}
              onClick={() => void skip()}
              disabled={isLoading}
            >
              {isAr ? "المتابعة كضيف" : "Continue as Guest"}
            </Button>
          </PremiumCard>
        </div>
      </motion.div>
    </section>
  );
}
