"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Gavel, ShieldAlert, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketplaceEnforcementAuditEntry, MarketplaceEnforcementRecord } from "@/types/alpha-exchange";

type EnforcementStatus = {
  restricted: boolean;
  blockReason: string | null;
  activeRecord?: MarketplaceEnforcementRecord;
  latestRecord?: MarketplaceEnforcementRecord;
  recentAuditEntries: MarketplaceEnforcementAuditEntry[];
  totalCases: number;
};

type MarketplaceEnforcementOwnerPanelProps = {
  locale: "ar" | "en";
  sellerId: string;
  initialStatus: EnforcementStatus;
};

function formatDate(value: string | undefined, locale: "ar" | "en") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "ar" ? "تاريخ غير متاح" : value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL-u-nu-latn" : "en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const AUDIT_ACTION_LABELS: Record<MarketplaceEnforcementAuditEntry["action"], { ar: string; en: string }> = {
  fee_issued: { ar: "تم فرض رسوم الاستعادة", en: "Recovery fee issued" },
  payment_submitted: { ar: "تم إرسال الدفع للمراجعة", en: "Payment submitted for review" },
  fee_paid: { ar: "تم تأكيد دفع الرسوم", en: "Recovery fee marked paid" },
  appeal_submitted: { ar: "تم تقديم استئناف", en: "Appeal submitted" },
  appeal_decided: { ar: "تم اتخاذ قرار بشأن الاستئناف", en: "Appeal decision recorded" },
  restriction_removed: { ar: "تمت إزالة التقييد", en: "Restriction removed" },
  seller_revoked: { ar: "تم إلغاء صلاحيات البائع", en: "Seller privileges revoked" },
  admin_note: { ar: "ملاحظة إدارية", en: "Admin note" },
};

const KNOWN_COMPLIANCE_TEXT: Record<string, string> = {
  "marketplace compliance violation": "مخالفة امتثال السوق",
  "payment verified": "تم التحقق من الدفع",
  "recovery fee payment verified by owner": "تحقق المالك من دفع رسوم الاستعادة",
  "manual admin resolution": "حل يدوي من الإدارة",
  "second confirmed marketplace policy violation": "مخالفة ثانية مؤكدة لسياسة السوق",
  "appeal accepted by owner": "قبل المالك الاستئناف",
  "appeal rejected after review": "رُفض الاستئناف بعد المراجعة",
};

function localizedAuditAction(action: MarketplaceEnforcementAuditEntry["action"], locale: "ar" | "en") {
  const labels = AUDIT_ACTION_LABELS[action];
  if (labels) return labels[locale];
  return locale === "ar" ? "نشاط امتثال" : String(action).replaceAll("_", " ");
}

function localizedComplianceText(value: string, locale: "ar" | "en") {
  if (locale === "en" || /[\u0600-\u06ff]/u.test(value)) return value;
  const normalized = value.trim().replace(/[.!?]+$/u, "").toLowerCase();
  return KNOWN_COMPLIANCE_TEXT[normalized] ?? "تفاصيل مسجلة في سجل الامتثال";
}

function localizedRestrictionMessage(status: EnforcementStatus, locale: "ar" | "en") {
  if (locale === "en") return status.blockReason ?? "Marketplace restriction is active.";
  const record = status.activeRecord;
  if (!record) {
    return status.blockReason && /[\u0600-\u06ff]/u.test(status.blockReason)
      ? status.blockReason
      : "يوجد تقييد نشط على حساب البائع.";
  }
  const parts = [
    `حساب البائع مقيّد مؤقتًا بسبب مخالفة سياسة السوق رقم ${record.violationNumber}.`,
    `يجب دفع رسوم الاستعادة بقيمة ${record.feeAmount.toFixed(2)} ${record.feeCurrency} لاستعادة صلاحية إنشاء العروض ونشرها.`,
  ];
  if (record.recoveryPaymentStatus === "awaiting_verification") {
    parts.push("الدفع في انتظار تحقق المالك.");
  }
  if (record.dueAt) {
    parts.push(`موعد الاستحقاق: ${formatDate(record.dueAt, "ar")}.`);
  }
  return parts.join(" ");
}

export function MarketplaceEnforcementOwnerPanel({ locale, sellerId, initialStatus }: MarketplaceEnforcementOwnerPanelProps) {
  const isAr = locale === "ar";
  const [status, setStatus] = useState<EnforcementStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueFeeOpen, setIssueFeeOpen] = useState(false);
  const [issueFeeAmount, setIssueFeeAmount] = useState("150");
  const [issueFeeReason, setIssueFeeReason] = useState(isAr ? "مخالفة امتثال السوق" : "Marketplace compliance violation");
  const [issueFeeNotes, setIssueFeeNotes] = useState("");
  const [issueFeeEvidenceFiles, setIssueFeeEvidenceFiles] = useState<File[]>([]);
  const evidenceInputId = useId();
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  async function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error(isAr ? "تعذرت قراءة ملف الإثبات." : "Could not read evidence file."));
      };
      reader.onerror = () => reject(new Error(isAr ? "تعذرت قراءة ملف الإثبات." : "Could not read evidence file."));
      reader.readAsDataURL(file);
    });
  }

  function resetIssueFeeForm() {
    setIssueFeeOpen(false);
    setIssueFeeAmount("150");
    setIssueFeeReason(isAr ? "مخالفة امتثال السوق" : "Marketplace compliance violation");
    setIssueFeeNotes("");
    setIssueFeeEvidenceFiles([]);
    if (evidenceInputRef.current) evidenceInputRef.current.value = "";
  }

  async function runAction(action: "issue_fee" | "mark_paid" | "confirm_payment" | "remove_restriction" | "revoke_seller" | "appeal_accept" | "appeal_reject") {
    if (busy) return;
    setError(null);

    let payload: Record<string, unknown> = { action };
    if (action === "issue_fee") {
      const feeAmount = Number(issueFeeAmount);
      if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
        setError(isAr ? "يجب أن يكون مبلغ الرسوم رقماً صالحاً أكبر من صفر." : "Fee amount must be a valid number greater than zero.");
        return;
      }
      if (!issueFeeReason.trim()) {
        setError(isAr ? "سبب المخالفة مطلوب." : "Violation reason is required.");
        return;
      }
      if (!issueFeeNotes.trim()) {
        setError(isAr ? "ملاحظات الإدارة الداخلية مطلوبة." : "Internal admin notes are required.");
        return;
      }
      if (issueFeeEvidenceFiles.length === 0) {
        setError(isAr ? "يجب رفع لقطة شاشة أو صورة أو ملف PDF واحد على الأقل كإثبات." : "At least one screenshot/image/PDF evidence file is required.");
        return;
      }
      if (!window.confirm(isAr ? `فرض رسوم استعادة امتثال بقيمة ${feeAmount.toFixed(2)} USDT وتقييد إجراءات البائع؟` : `Issue Marketplace Compliance Recovery Fee for ${feeAmount.toFixed(2)} USDT and restrict seller actions?`)) return;
      const encodedEvidence = await Promise.all(issueFeeEvidenceFiles.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        fileData: await fileToDataUrl(file),
      })));
      payload = {
        action,
        feeAmount,
        reason: issueFeeReason.trim(),
        notes: issueFeeNotes.trim(),
        evidenceFiles: encodedEvidence,
      };
    }

    if (action === "mark_paid") {
      if (!window.confirm(isAr ? "تحديد رسوم الاستعادة كمدفوعة وإعادة صلاحيات عروض البائع؟" : "Mark this Marketplace Recovery Fee as paid and restore seller listing permissions?")) return;
      const reason = window.prompt(isAr ? "سبب اختياري" : "Optional reason", isAr ? "تم التحقق من الدفع" : "Payment verified");
      payload = { action, reason: reason?.trim() || undefined };
    }

    if (action === "confirm_payment") {
      if (!window.confirm(isAr ? "تأكيد دفع البائع وإزالة التقييد وإعادة صلاحياته؟" : "Confirm seller payment, remove restriction, and restore seller privileges?")) return;
      payload = { action, reason: isAr ? "تحقق المالك من دفع رسوم الاستعادة" : "Recovery fee payment verified by owner" };
    }

    if (action === "remove_restriction") {
      if (!window.confirm(isAr ? "إزالة تقييد السوق النشط دون دفع؟" : "Remove active marketplace restriction without payment?")) return;
      const reason = window.prompt(isAr ? "سبب الإزالة اليدوية" : "Reason for manual removal", isAr ? "حل يدوي من الإدارة" : "Manual admin resolution");
      if (!reason?.trim()) return;
      payload = { action, reason: reason.trim() };
    }

    if (action === "revoke_seller") {
      if (!window.confirm(isAr ? "إلغاء صلاحيات هذا البائع في السوق نهائياً؟ سيؤدي ذلك إلى إغلاق عروضه المفتوحة." : "Permanently revoke this seller's marketplace privileges? This closes open listings.")) return;
      const reason = window.prompt(isAr ? "سبب الإلغاء النهائي" : "Reason for permanent revoke", isAr ? "مخالفة مؤكدة ثانية لسياسة السوق" : "Second confirmed marketplace policy violation");
      if (!reason?.trim()) return;
      payload = { action, reason: reason.trim() };
    }

    if (action === "appeal_accept" || action === "appeal_reject") {
      const decision = action === "appeal_accept" ? "accepted" : "rejected";
      if (!window.confirm(isAr ? `تأكيد قرار الاستئناف: ${decision === "accepted" ? "مقبول" : "مرفوض"}؟` : `Confirm appeal decision: ${decision}?`)) return;
      const notes = window.prompt(isAr ? "ملاحظات القرار (مطلوبة)" : "Decision notes (required)", decision === "accepted" ? (isAr ? "قبل المالك الاستئناف" : "Appeal accepted by owner") : (isAr ? "رُفض الاستئناف بعد المراجعة" : "Appeal rejected after review"));
      if (!notes?.trim()) {
        setError(isAr ? "ملاحظات قرار الاستئناف مطلوبة." : "Appeal decision notes are required.");
        return;
      }
      payload = { action: "appeal_decision", decision, notes: notes.trim() };
    }

    try {
      setBusy(true);
      const response = await fetch(`/api/alpha-exchange/admin/sellers/${sellerId}/enforcement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { enforcement?: EnforcementStatus; error?: string };
      if (!response.ok || !data.enforcement) {
        setError(isAr ? "تعذر تطبيق إجراء الامتثال." : (data.error ?? "Failed to apply compliance action."));
        return;
      }
      setStatus(data.enforcement);
      if (action === "issue_fee") {
        resetIssueFeeForm();
      }
    } catch {
      setError(isAr ? "تعذر تطبيق إجراء الامتثال." : "Failed to apply compliance action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/25 bg-[#0B0B0B]/95">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-100">
          <ShieldAlert className="h-5 w-5 text-red-300" />
          {isAr ? "امتثال السوق" : "Marketplace Compliance"}
        </CardTitle>
        <CardDescription>
          {isAr
            ? "إجراءات المالك/الإدارة لتقييد أو استعادة أو إلغاء صلاحيات البائع مع سجل تدقيق دائم."
            : "Owner/admin controls for restricting, restoring, or revoking seller marketplace privileges with immutable audit history."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الحالة" : "Status"}</p>
            <p className={`mt-1 text-sm font-semibold ${status.restricted ? "text-red-300" : "text-emerald-300"}`}>
              {status.restricted ? (isAr ? "مقيّد" : "Restricted") : (isAr ? "سليم" : "Clear")}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "المخالفة" : "Violation"}</p>
            <p className="mt-1 text-sm font-semibold text-white">#{status.activeRecord?.violationNumber ?? status.latestRecord?.violationNumber ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "رسوم الاستعادة" : "Recovery Fee"}</p>
            <p className="mt-1 text-sm font-semibold text-[#FDE68A]">
              {status.activeRecord ? `${status.activeRecord.feeAmount.toFixed(2)} ${status.activeRecord.feeCurrency}` : "0.00 USDT"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إجمالي الحالات" : "Total Cases"}</p>
            <p className="mt-1 text-sm font-semibold text-white">{status.totalCases}</p>
          </div>
        </div>

        {status.blockReason ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
            <p className="inline-flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{isAr ? "التقييد الحالي" : "Current restriction"}</p>
            <p className="mt-1">{localizedRestrictionMessage(status, locale)}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <p className="inline-flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />{isAr ? "لا يوجد تقييد نشط" : "No active restriction"}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || status.restricted} onClick={() => setIssueFeeOpen((current) => !current)}>{isAr ? "فرض رسوم استعادة" : "Issue Recovery Fee"}</Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.recoveryPaymentStatus !== "awaiting_verification"} onClick={() => void runAction("confirm_payment")}>{isAr ? "تأكيد الدفع" : "Confirm Payment"}</Button>
          <Button type="button" variant="secondary" disabled={busy || !status.restricted} onClick={() => void runAction("mark_paid")}>{isAr ? "تحديد كمدفوع (يدوي)" : "Mark Paid (Manual)"}</Button>
          <Button type="button" variant="secondary" disabled={busy || !status.restricted} onClick={() => void runAction("remove_restriction")}>{isAr ? "إزالة التقييد" : "Remove Restriction"}</Button>
          <Button type="button" disabled={busy} onClick={() => void runAction("revoke_seller")} className="bg-red-600 text-white hover:bg-red-500">
            <Gavel className="me-1.5 h-4 w-4" />
            {isAr ? "إلغاء صلاحيات البائع" : "Revoke Seller"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.appealStatus !== "submitted"} onClick={() => void runAction("appeal_accept")}>{isAr ? "قبول الاستئناف" : "Accept Appeal"}</Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.appealStatus !== "submitted"} onClick={() => void runAction("appeal_reject")}>{isAr ? "رفض الاستئناف" : "Reject Appeal"}</Button>
        </div>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {issueFeeOpen ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div>
              <p className="text-sm font-semibold text-white">{isAr ? "فرض رسوم استعادة السوق" : "Issue Marketplace Recovery Fee"}</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "اختر مبلغ الرسوم قبل فرض التقييد ليتمكن البائع من رؤية رسوم الاستعادة الدقيقة." : "Choose the fee amount before issuing the restriction so the seller can see the exact recovery charge."}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm text-[#D1D5DB]">
                <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "مبلغ الرسوم بـ USDT" : "Fee amount in USDT"}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={issueFeeAmount}
                  onChange={(event) => setIssueFeeAmount(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#080808] px-3 text-white outline-none transition focus:border-[#C9A227]"
                />
              </label>
              <label className="space-y-1.5 text-sm text-[#D1D5DB]">
                <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "سبب المخالفة" : "Violation reason"}</span>
                <input
                  type="text"
                  value={issueFeeReason}
                  onChange={(event) => setIssueFeeReason(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#080808] px-3 text-white outline-none transition focus:border-[#C9A227]"
                />
              </label>
            </div>
            <label className="space-y-1.5 text-sm text-[#D1D5DB]">
              <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "ملاحظات الإدارة الداخلية" : "Internal admin notes"}</span>
              <textarea
                value={issueFeeNotes}
                onChange={(event) => setIssueFeeNotes(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-[#080808] px-3 py-2 text-white outline-none transition focus:border-[#C9A227]"
                placeholder={isAr ? "وثّق سبب إجراء الامتثال" : "Document the reason for the compliance action"}
              />
            </label>
            <div className="space-y-2 text-sm text-[#D1D5DB]">
              <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "ملفات الإثبات" : "Evidence files"}</p>
              <input
                ref={evidenceInputRef}
                id={evidenceInputId}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                aria-describedby={`${evidenceInputId}-help`}
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => setIssueFeeEvidenceFiles(Array.from(event.target.files ?? []))}
                className="peer sr-only"
              />
              <label
                htmlFor={evidenceInputId}
                className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#C9A227]/55 bg-[#C9A227]/10 px-4 py-3 font-medium text-[#FDE68A] transition hover:border-[#FDE68A] hover:bg-[#C9A227]/15 peer-focus:ring-2 peer-focus:ring-[#C9A227] peer-focus:ring-offset-2 peer-focus:ring-offset-[#080808]"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{isAr ? "اختر صورة أو ملف PDF" : "Choose image or PDF files"}</span>
              </label>
              <p id={`${evidenceInputId}-help`} className="text-xs text-[#9CA3AF]">
                {issueFeeEvidenceFiles.length
                  ? (isAr ? `تم اختيار ${issueFeeEvidenceFiles.length} ملف` : `${issueFeeEvidenceFiles.length} file${issueFeeEvidenceFiles.length === 1 ? "" : "s"} selected`)
                  : (isAr ? "ارفع لقطة شاشة أو صورة أو ملف PDF واحدًا على الأقل." : "Upload at least one screenshot, image, or PDF.")}
              </p>
              {issueFeeEvidenceFiles.length ? (
                <ul className="space-y-1.5" aria-label={isAr ? "الملفات المحددة" : "Selected files"}>
                  {issueFeeEvidenceFiles.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-xs">
                      <FileText className="h-4 w-4 shrink-0 text-[#C9A227]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate" dir="auto">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setIssueFeeEvidenceFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#D1D5DB] transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                        aria-label={isAr ? `إزالة الملف ${file.name}` : `Remove file ${file.name}`}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={resetIssueFeeForm}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button type="button" disabled={busy} onClick={() => void runAction("issue_fee")}>{isAr ? "فرض رسوم الاستعادة" : "Issue Recovery Fee"}</Button>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "أحدث نشاطات الامتثال" : "Recent Compliance Activity"}</p>
          <div className="mt-3 space-y-2">
            {status.recentAuditEntries.length ? status.recentAuditEntries.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-xs text-[#E5E7EB]">
                <p className="font-semibold text-white">{localizedAuditAction(entry.action, locale)}</p>
                <p className="mt-0.5 text-[#9CA3AF]">{formatDate(entry.createdAt, locale)}</p>
                {entry.reason ? <p className="mt-1">{isAr ? "السبب" : "Reason"}: {localizedComplianceText(entry.reason, locale)}</p> : null}
                {entry.evidenceReferences?.length ? <p className="mt-1 text-[#C9A227]">{isAr ? "الإثبات" : "Evidence"}: {entry.evidenceReferences.length} {isAr ? "مرفقات" : "attachment(s)"}</p> : null}
              </div>
            )) : <p className="text-sm text-[#9CA3AF]">{isAr ? "لا يوجد نشاط امتثال حتى الآن." : "No compliance activity yet."}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
