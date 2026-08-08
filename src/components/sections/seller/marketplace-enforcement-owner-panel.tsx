"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Gavel, ShieldAlert } from "lucide-react";
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

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function MarketplaceEnforcementOwnerPanel({ locale, sellerId, initialStatus }: MarketplaceEnforcementOwnerPanelProps) {
  const isAr = locale === "ar";
  const [status, setStatus] = useState<EnforcementStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueFeeOpen, setIssueFeeOpen] = useState(false);
  const [issueFeeAmount, setIssueFeeAmount] = useState("150");
  const [issueFeeReason, setIssueFeeReason] = useState("Marketplace compliance violation");
  const [issueFeeNotes, setIssueFeeNotes] = useState("");
  const [issueFeeEvidenceFiles, setIssueFeeEvidenceFiles] = useState<File[]>([]);

  async function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Could not read evidence file."));
      };
      reader.onerror = () => reject(new Error("Could not read evidence file."));
      reader.readAsDataURL(file);
    });
  }

  function resetIssueFeeForm() {
    setIssueFeeOpen(false);
    setIssueFeeAmount("150");
    setIssueFeeReason("Marketplace compliance violation");
    setIssueFeeNotes("");
    setIssueFeeEvidenceFiles([]);
  }

  async function runAction(action: "issue_fee" | "mark_paid" | "confirm_payment" | "remove_restriction" | "revoke_seller" | "appeal_accept" | "appeal_reject") {
    if (busy) return;
    setError(null);

    let payload: Record<string, unknown> = { action };
    if (action === "issue_fee") {
      const feeAmount = Number(issueFeeAmount);
      if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
        setError("Fee amount must be a valid number greater than zero.");
        return;
      }
      if (!issueFeeReason.trim()) {
        setError("Violation reason is required.");
        return;
      }
      if (!issueFeeNotes.trim()) {
        setError("Internal admin notes are required.");
        return;
      }
      if (issueFeeEvidenceFiles.length === 0) {
        setError("At least one screenshot/image/PDF evidence file is required.");
        return;
      }
      if (!window.confirm(`Issue Marketplace Compliance Recovery Fee for ${feeAmount.toFixed(2)} USDT and restrict seller actions?`)) return;
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
      if (!window.confirm("Mark this Marketplace Recovery Fee as paid and restore seller listing permissions?")) return;
      const reason = window.prompt("Optional reason", "Payment verified");
      payload = { action, reason: reason?.trim() || undefined };
    }

    if (action === "confirm_payment") {
      if (!window.confirm("Confirm seller payment, remove restriction, and restore seller privileges?")) return;
      payload = { action, reason: "Recovery fee payment verified by owner" };
    }

    if (action === "remove_restriction") {
      if (!window.confirm("Remove active marketplace restriction without payment?")) return;
      const reason = window.prompt("Reason for manual removal", "Manual admin resolution");
      if (!reason?.trim()) return;
      payload = { action, reason: reason.trim() };
    }

    if (action === "revoke_seller") {
      if (!window.confirm("Permanently revoke this seller's marketplace privileges? This closes open listings.")) return;
      const reason = window.prompt("Reason for permanent revoke", "Second confirmed marketplace policy violation");
      if (!reason?.trim()) return;
      payload = { action, reason: reason.trim() };
    }

    if (action === "appeal_accept" || action === "appeal_reject") {
      const decision = action === "appeal_accept" ? "accepted" : "rejected";
      if (!window.confirm(`Confirm appeal decision: ${decision}?`)) return;
      const notes = window.prompt("Decision notes (required)", decision === "accepted" ? "Appeal accepted by owner" : "Appeal rejected after review");
      if (!notes?.trim()) {
        setError("Appeal decision notes are required.");
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
        setError(data.error ?? "Failed to apply compliance action.");
        return;
      }
      setStatus(data.enforcement);
      if (action === "issue_fee") {
        resetIssueFeeForm();
      }
    } catch {
      setError("Failed to apply compliance action.");
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
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">Status</p>
            <p className={`mt-1 text-sm font-semibold ${status.restricted ? "text-red-300" : "text-emerald-300"}`}>
              {status.restricted ? "Restricted" : "Clear"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">Violation</p>
            <p className="mt-1 text-sm font-semibold text-white">#{status.activeRecord?.violationNumber ?? status.latestRecord?.violationNumber ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">Recovery Fee</p>
            <p className="mt-1 text-sm font-semibold text-[#FDE68A]">
              {status.activeRecord ? `${status.activeRecord.feeAmount.toFixed(2)} ${status.activeRecord.feeCurrency}` : "0.00 USDT"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">Total Cases</p>
            <p className="mt-1 text-sm font-semibold text-white">{status.totalCases}</p>
          </div>
        </div>

        {status.blockReason ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
            <p className="inline-flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Current restriction</p>
            <p className="mt-1">{status.blockReason}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <p className="inline-flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />No active restriction</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy || status.restricted} onClick={() => setIssueFeeOpen((current) => !current)}>Issue Recovery Fee</Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.recoveryPaymentStatus !== "awaiting_verification"} onClick={() => void runAction("confirm_payment")}>Confirm Payment</Button>
          <Button type="button" variant="secondary" disabled={busy || !status.restricted} onClick={() => void runAction("mark_paid")}>Mark Paid (Manual)</Button>
          <Button type="button" variant="secondary" disabled={busy || !status.restricted} onClick={() => void runAction("remove_restriction")}>Remove Restriction</Button>
          <Button type="button" disabled={busy} onClick={() => void runAction("revoke_seller")} className="bg-red-600 text-white hover:bg-red-500">
            <Gavel className="mr-1.5 h-4 w-4" />
            Revoke Seller
          </Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.appealStatus !== "submitted"} onClick={() => void runAction("appeal_accept")}>Accept Appeal</Button>
          <Button type="button" variant="secondary" disabled={busy || status.activeRecord?.appealStatus !== "submitted"} onClick={() => void runAction("appeal_reject")}>Reject Appeal</Button>
        </div>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {issueFeeOpen ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div>
              <p className="text-sm font-semibold text-white">Issue Marketplace Recovery Fee</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">Choose the fee amount before issuing the restriction so the seller can see the exact recovery charge.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm text-[#D1D5DB]">
                <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Fee amount in USDT</span>
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
                <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Violation reason</span>
                <input
                  type="text"
                  value={issueFeeReason}
                  onChange={(event) => setIssueFeeReason(event.target.value)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#080808] px-3 text-white outline-none transition focus:border-[#C9A227]"
                />
              </label>
            </div>
            <label className="space-y-1.5 text-sm text-[#D1D5DB]">
              <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Internal admin notes</span>
              <textarea
                value={issueFeeNotes}
                onChange={(event) => setIssueFeeNotes(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-[#080808] px-3 py-2 text-white outline-none transition focus:border-[#C9A227]"
                placeholder="Document the reason for the compliance action"
              />
            </label>
            <label className="space-y-1.5 text-sm text-[#D1D5DB]">
              <span className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Evidence files</span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(event) => setIssueFeeEvidenceFiles(Array.from(event.target.files ?? []))}
                className="block w-full rounded-xl border border-white/10 bg-[#080808] px-3 py-2 text-sm text-[#D1D5DB] file:mr-3 file:rounded-lg file:border-0 file:bg-[#C9A227] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-black"
              />
              <p className="text-xs text-[#9CA3AF]">{issueFeeEvidenceFiles.length ? `${issueFeeEvidenceFiles.length} file(s) selected` : "Upload at least one screenshot, image, or PDF."}</p>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={resetIssueFeeForm}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={() => void runAction("issue_fee")}>Issue Recovery Fee</Button>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Recent Compliance Activity</p>
          <div className="mt-3 space-y-2">
            {status.recentAuditEntries.length ? status.recentAuditEntries.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-xs text-[#E5E7EB]">
                <p className="font-semibold text-white">{entry.action.replaceAll("_", " ")}</p>
                <p className="mt-0.5 text-[#9CA3AF]">{formatDate(entry.createdAt)}</p>
                {entry.reason ? <p className="mt-1">Reason: {entry.reason}</p> : null}
                {entry.evidenceReferences?.length ? <p className="mt-1 text-[#C9A227]">Evidence: {entry.evidenceReferences.length} attachment(s)</p> : null}
              </div>
            )) : <p className="text-sm text-[#9CA3AF]">No compliance activity yet.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
