"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, ShieldCheck, Store, UserCircle2, Sparkles, Clock3, CheckCircle2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POST_ONBOARDING_KEY = "post_onboarding_redirect";
const SUPPORTED_NETWORKS = ["TRC20", "ERC20", "BEP20", "SOL"] as const;
type Network = (typeof SUPPORTED_NETWORKS)[number];

type Props = {
  locale: "ar" | "en";
  isBuyer?: boolean;
  sellerStatus?: string;
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

  const isLoading = loading !== null;
  const sellerNeedsReview = sellerStatus === "pending_seller_approval" || sellerStep === "applied";
  const sellerIsApproved = sellerStatus === "approved_seller";

  const profileHint = useMemo(
    () => (isAr ? "يمكنك تعديل كل هذه الخيارات لاحقًا من الإعدادات." : "You can refine all of these settings later from your account settings."),
    [isAr],
  );

  function withSupportDetails(payload: ApiErrorPayload, fallback: string) {
    const message = payload.error ?? fallback;
    if (!payload.supportCode && !payload.requestId) return message;
    const suffix = [payload.supportCode, payload.requestId].filter(Boolean).join(" • ");
    return `${message} (${suffix})`;
  }

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
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Failed to send verification code."));
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
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Verification failed."));
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
        body: JSON.stringify({
          firstName: seller.firstName,
          lastName: seller.lastName,
          displayName: seller.displayName,
          phone: seller.phone,
        }),
      });
      const payload = (await res.json()) as ApiErrorPayload;
      if (!res.ok) throw new Error(withSupportDetails(payload, "Failed to send verification code."));
      setSellerStep("otp_sent");
      setSellerStatus2(payload.message ?? "Verification code sent.");
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : "Failed to send verification code.");
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
      if (!verifyRes.ok) throw new Error(withSupportDetails(verifyPayload, "Verification failed."));
      await submitSellerApplication();
    } catch (err) {
      setSellerError(err instanceof Error ? err.message : "Verification failed.");
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
            subtitle={isAr ? "تحقق سريع عبر OTP ثم الوصول الكامل إلى السوق." : "Quick OTP verification to unlock marketplace access."}
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
              <Input
                aria-label={isAr ? "رقم الهاتف الإسرائيلي" : "Israeli mobile number"}
                placeholder={isAr ? "رقم الهاتف الإسرائيلي (+972 / 05...)" : "Israeli mobile (+972 / 05...)"}
                value={buyer.phone}
                onChange={(event) => setBuyer((prev) => ({ ...prev, phone: event.target.value }))}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="flex-1" onClick={() => void sendOtp()} disabled={isLoading}>
                  {loading === "sendOtp" ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
                </Button>
                <Input
                  aria-label={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                  placeholder={isAr ? "رمز مكون من 6 أرقام" : "6-digit code"}
                  value={buyer.token}
                  onChange={(event) => setBuyer((prev) => ({ ...prev, token: event.target.value }))}
                />
              </div>
              <Button type="button" variant="secondary" onClick={() => void verifyOtp()} disabled={isLoading || buyer.token.length !== 6}>
                {loading === "verifyOtp" ? (isAr ? "جارٍ التحقق..." : "Verifying...") : (isAr ? "تأكيد وتفعيل المشتري" : "Verify & activate Buyer")}
              </Button>
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
                  <p className="text-xs text-[#AEB5C2]">{isAr ? "اختر الشبكات المفضلة للتداول:" : "Select preferred trading networks:"}</p>
                  <div className="flex flex-wrap gap-2">
                    {SUPPORTED_NETWORKS.map((net) => (
                      <button
                        key={net}
                        type="button"
                        onClick={() => toggleNetwork(net)}
                        className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                          seller.preferredNetworks.includes(net)
                            ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
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
                  <Button type="button" onClick={() => void submitSellerApplication()} disabled={isLoading || seller.preferredNetworks.length === 0}>
                    {loading === "seller_apply" ? (isAr ? "جارٍ الإرسال..." : "Submitting...") : (isAr ? "تقديم طلب البائع" : "Submit Seller Application")}
                  </Button>
                </motion.div>
              ) : sellerStep === "otp_sent" ? (
                <motion.div key="seller-otp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2">
                  {sellerStatus2 ? <p className="text-xs text-emerald-300">{sellerStatus2}</p> : null}
                  <p className="text-xs text-[#AEB5C2]">{isAr ? "اختر الشبكات المفضلة للتداول:" : "Select preferred trading networks:"}</p>
                  <div className="flex flex-wrap gap-2">
                    {SUPPORTED_NETWORKS.map((net) => (
                      <button
                        key={net}
                        type="button"
                        onClick={() => toggleNetwork(net)}
                        className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                          seller.preferredNetworks.includes(net)
                            ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
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
                    {loading === "seller_verify" || loading === "seller_apply"
                      ? (isAr ? "جارٍ التحقق..." : "Verifying...")
                      : (isAr ? "تحقق وتقديم الطلب" : "Verify & Submit Application")}
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
                  <p className="text-xs text-[#AEB5C2]">{isAr ? "الشبكات المفضلة للتداول:" : "Preferred trading networks:"}</p>
                  <div className="flex flex-wrap gap-2">
                    {SUPPORTED_NETWORKS.map((net) => (
                      <button
                        key={net}
                        type="button"
                        onClick={() => toggleNetwork(net)}
                        className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                          seller.preferredNetworks.includes(net)
                            ? "border-[#C9A227] bg-[#C9A227]/20 text-[#F4D87A]"
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
                  <Button
                    type="button"
                    onClick={() => void sellerSendOtp()}
                    disabled={isLoading || !seller.firstName || !seller.lastName || !seller.phone || seller.preferredNetworks.length === 0}
                  >
                    {loading === "seller_sendOtp" ? (isAr ? "جارٍ الإرسال..." : "Sending...") : (isAr ? "إرسال رمز التحقق" : "Send verification code")}
                  </Button>
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
            <Button type="button" className="w-full" onClick={() => void becomeStudent()} disabled={isLoading}>
              {loading === "student" ? (isAr ? "جارٍ التفعيل..." : "Activating...") : (isAr ? "تفعيل دور الطالب" : "Become a Student")}
            </Button>
          </PremiumCard>

          <PremiumCard
            title={isAr ? "Continue as Guest" : "Continue as Guest"}
            subtitle={isAr ? "استكشف الواجهة الآن وحدد دورك لاحقًا." : "Explore now and choose your role later."}
            icon={UserCircle2}
            accent="slate"
          >
            <Button type="button" variant="secondary" className="w-full" onClick={() => void skip()} disabled={isLoading}>
              {loading === "skip" ? (isAr ? "جاري المتابعة..." : "Continuing...") : (isAr ? "المتابعة كضيف" : "Continue as Guest")}
            </Button>
          </PremiumCard>
        </div>
      </motion.div>
    </section>
  );
}
