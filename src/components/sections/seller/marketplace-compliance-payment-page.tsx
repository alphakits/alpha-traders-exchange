"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketplaceEnforcementRecord } from "@/types/alpha-exchange";

type SellerComplianceStatus = {
  restricted: boolean;
  blockReason: string | null;
  activeRecord?: MarketplaceEnforcementRecord;
};

type Payload = {
  enforcement: SellerComplianceStatus;
};

export function MarketplaceCompliancePaymentPage({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [status, setStatus] = useState<SellerComplianceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [appealMessage, setAppealMessage] = useState("");

  const activeRecord = status?.activeRecord;

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/alpha-exchange/seller/compliance-payment", { cache: "no-store" });
        const data = (await response.json()) as Payload & { error?: string };
        if (!response.ok) {
          setError(isAr ? "تعذر تحميل تفاصيل دفع الامتثال." : (data.error ?? "Failed to load compliance payment details."));
          return;
        }
        setStatus(data.enforcement);
      } catch {
        setError(isAr ? "تعذر تحميل تفاصيل دفع الامتثال." : "Failed to load compliance payment details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [isAr]);

  useEffect(() => {
    if (!activeRecord?.recoveryPaymentQrPayload) {
      setQrDataUrl("");
      return;
    }
    void import("qrcode").then((QRCode) => {
      void QRCode.toDataURL(activeRecord.recoveryPaymentQrPayload!, {
        width: 180,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
    }).catch(() => setQrDataUrl(""));
  }, [activeRecord?.recoveryPaymentQrPayload]);

  const paymentStatusLabel = useMemo(() => {
    const statusValue = activeRecord?.recoveryPaymentStatus ?? "pending_payment";
    if (statusValue === "awaiting_verification") return isAr ? "بانتظار التحقق" : "Awaiting Verification";
    if (statusValue === "confirmed_paid") return isAr ? "تم التأكيد" : "Confirmed";
    return isAr ? "بانتظار الدفع" : "Pending Payment";
  }, [activeRecord?.recoveryPaymentStatus, isAr]);

  async function refresh() {
    try {
      const response = await fetch("/api/alpha-exchange/seller/compliance-payment", { cache: "no-store" });
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to refresh compliance state.");
      setStatus(data.enforcement);
    } catch {
      setError(isAr ? "تعذر تحديث حالة الامتثال." : "Failed to refresh compliance state.");
    }
  }

  async function handleSubmitPayment() {
    if (!activeRecord) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/seller/compliance-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit_payment", note: "Payment submitted by seller." }),
      });
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(isAr ? "تعذر إرسال الدفعة." : (data.error ?? "Failed to submit payment."));
      setStatus(data.enforcement);
      setMessage(isAr ? "تم إرسال الدفع وبانتظار التحقق من المالك." : "Payment submitted. Waiting for owner verification.");
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(isAr ? "تعذر إرسال الدفعة." : (detail || "Failed to submit payment."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitAppeal() {
    const appeal = appealMessage.trim();
    if (!appeal) {
      setError(isAr ? "اكتب سبب الاستئناف أولًا." : "Please enter an appeal message first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/seller/compliance-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit_appeal", appealMessage: appeal }),
      });
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(isAr ? "تعذر إرسال الاستئناف." : (data.error ?? "Failed to submit appeal."));
      setStatus(data.enforcement);
      setMessage(isAr ? "تم إرسال الاستئناف للمراجعة." : "Appeal submitted for owner review.");
      setAppealMessage("");
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(isAr ? "تعذر إرسال الاستئناف." : (detail || "Failed to submit appeal."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyWallet() {
    if (!activeRecord?.recoveryWalletAddress) return;
    try {
      await navigator.clipboard.writeText(activeRecord.recoveryWalletAddress);
      setMessage(isAr ? "تم نسخ عنوان المحفظة." : "Wallet address copied.");
    } catch {
      setError(isAr ? "تعذر نسخ عنوان المحفظة." : "Could not copy wallet address.");
    }
  }

  if (loading) {
    return <p className="text-sm text-[#9CA3AF]">{isAr ? "جار التحميل..." : "Loading..."}</p>;
  }

  if (!status?.restricted || !activeRecord) {
    return (
      <Card className="border-emerald-500/25 bg-[#0B0B0B]/95">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-200"><ShieldCheck className="h-5 w-5" />{isAr ? "لا توجد قيود نشطة" : "No Active Compliance Restriction"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#D1D5DB]">{isAr ? "كل صلاحيات البائع مفعلة حاليًا." : "Seller marketplace privileges are currently active."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-red-500/25 bg-[radial-gradient(circle_at_top_right,rgba(185,28,28,0.16),transparent_36%),#0B0B0B]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-100"><Wallet className="h-5 w-5 text-red-300" />{isAr ? "دفع رسوم امتثال السوق" : "Marketplace Compliance Payment"}</CardTitle>
          <CardDescription>{isAr ? "ادفع رسوم الاسترداد عبر محفظة المنصة ثم أرسل إشعار الدفع للتحقق." : "Pay the Marketplace Recovery Fee to the platform wallet, then submit for verification."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "الحالة" : "Status"}</p><p className="mt-1 font-semibold text-white">{paymentStatusLabel}</p></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "المخالفة" : "Violation"}</p><p className="mt-1 font-semibold text-white"><bdi dir="ltr">#{activeRecord.violationNumber}</bdi></p></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "المبلغ المستحق" : "Amount Due"}</p><p className="mt-1 font-semibold text-[#FDE68A]"><bdi dir="ltr">{activeRecord.feeAmount.toFixed(2)} {activeRecord.feeCurrency}</bdi></p></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className="text-xs text-[#9CA3AF]">{isAr ? "الشبكة" : "Network"}</p><p className="mt-1 font-semibold text-white"><bdi dir="ltr">{activeRecord.recoveryWalletNetwork ?? "-"}</bdi></p></div>
          </div>

          <div className="rounded-2xl border border-[#C9A227]/30 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-[#C9A227]">{isAr ? "محفظة الاسترداد" : "Recovery Wallet"}</p>
            <p dir="ltr" className="mt-2 break-all rounded-lg border border-white/10 bg-black/50 p-3 text-left font-mono text-sm text-white">{activeRecord.recoveryWalletAddress}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => void handleCopyWallet()}><Copy className="mr-1.5 h-4 w-4" />{isAr ? "نسخ العنوان" : "Copy Wallet"}</Button>
              <Button type="button" disabled={busy || activeRecord.recoveryPaymentStatus === "awaiting_verification" || activeRecord.recoveryPaymentStatus === "confirmed_paid"} onClick={() => void handleSubmitPayment()}>
                {isAr ? "لقد أرسلت الدفع" : "I've Sent Payment"}
              </Button>
            </div>
            <p className="mt-3 text-xs leading-6 text-[#D1D5DB]">
              {isAr
                ? "بعد التحقق من الدفع، ستتم استعادة صلاحيات البيع تلقائيًا. إذا تكررت مخالفة موثقة ثانية، فقد تُسحب منك صفة البائع المعتمد بشكل دائم."
                : "After payment is verified, selling permissions will be restored automatically. If a second confirmed violation occurs, Approved Seller privileges may be permanently revoked."}
            </p>
          </div>

          {qrDataUrl ? (
            <div className="inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt={isAr ? "رمز QR للدفع" : "Payment QR code"} className="h-40 w-40 rounded-lg bg-white p-2" />
              <p className="max-w-xs text-sm text-[#D1D5DB]">{isAr ? "امسح الكود من محفظتك لإدخال العنوان والمبلغ تلقائيًا." : "Scan this code to prefill wallet address and payment amount in your wallet app."}</p>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "استئناف (اختياري)" : "Optional Appeal"}</p>
            <textarea
              value={appealMessage}
              onChange={(event) => setAppealMessage(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
              placeholder={isAr ? "اكتب سبب الاستئناف" : "Explain your appeal reason"}
            />
            <Button type="button" variant="secondary" className="mt-2" disabled={busy || activeRecord.appealStatus === "submitted"} onClick={() => void handleSubmitAppeal()}>
              {activeRecord.appealStatus === "submitted" ? (isAr ? "الاستئناف قيد المراجعة" : "Appeal Pending") : (isAr ? "إرسال استئناف" : "Submit Appeal")}
            </Button>
          </div>

          {status.blockReason ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
              <p className="inline-flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{isAr ? "سبب التقييد" : "Restriction Reason"}</p>
              <p className="mt-1">{isAr
                ? (/[؀-ۿ]/.test(status.blockReason)
                  ? status.blockReason
                  : "تم تقييد صلاحيات السوق بسبب مخالفة تتطلب المراجعة.")
                : status.blockReason}</p>
            </div>
          ) : null}

          {message ? <p className="text-sm text-emerald-300"><CheckCircle2 className="mr-1 inline h-4 w-4" />{message}</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <Button type="button" variant="ghost" className="text-[#9CA3AF]" onClick={() => void refresh()}>{isAr ? "تحديث الحالة" : "Refresh Status"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
