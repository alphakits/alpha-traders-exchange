"use client";

import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { currencyText } from "@/components/ui/currency-text";
import { HelpDetails } from "@/components/ui/help-details";
import { Textarea } from "@/components/ui/textarea";
import { TradeTermsPanel } from "@/components/sections/trade-room/trade-terms-panel";
import { isCashTradePaymentMethod, normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import type { SellerWorkspaceSectionProps } from "./seller-workspace-section";

type TradeCardWorkspace = Pick<SellerWorkspaceSectionProps,
  | "isAr" | "locale" | "sellerExpandedTradeId" | "setSellerExpandedTradeId"
  | "getTradeQueuePresentation" | "shortTradeRef" | "shortListingRef" | "safeText" | "toNumber"
  | "paymentMethodLabel" | "paymentMethodEmoji" | "paymentMethodTradeInstruction" | "myListingsById"
  | "handleOpenTradeRoom" | "handlePrefetchTradeRoom" | "handleSellerRequestAction" | "requestActionKey"
  | "sellerWorkspaceSummary" | "reviewPayableCommissions" | "sellerSafetyAcknowledgements" | "setSellerSafetyAcknowledgements"
  | "sellerEvidenceFiles" | "setSellerEvidenceFiles" | "evidenceUploading" | "uploadTradeEvidenceFile"
  | "LocalizedEvidenceFileInput" | "CompactTradeTimeline" | "handleSubmitSellerResponse"
  | "sellerResponseDrafts" | "setSellerResponseDrafts"
>;

export function SellerTradeRequestCard({ request, workspace }: {
  request: PurchaseRequest;
  workspace: TradeCardWorkspace;
}) {
  const {
    isAr, locale, sellerExpandedTradeId, setSellerExpandedTradeId,
    getTradeQueuePresentation, shortTradeRef, shortListingRef, safeText, toNumber,
    paymentMethodLabel, paymentMethodEmoji, paymentMethodTradeInstruction, myListingsById,
    handleOpenTradeRoom, handlePrefetchTradeRoom, handleSellerRequestAction, requestActionKey,
    sellerWorkspaceSummary, reviewPayableCommissions, sellerSafetyAcknowledgements, setSellerSafetyAcknowledgements,
    sellerEvidenceFiles, setSellerEvidenceFiles, evidenceUploading, uploadTradeEvidenceFile,
    LocalizedEvidenceFileInput, CompactTradeTimeline, handleSubmitSellerResponse,
    sellerResponseDrafts, setSellerResponseDrafts,
  } = workspace;
  const presentation = getTradeQueuePresentation(request, "seller", isAr);
  const isExpanded = sellerExpandedTradeId === request.id;
  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  const isClosed = presentation.section === "completed" || presentation.section === "cancelled";
  const isPending = request.status === "pending" && !isClosed;
  const isFaceToFace = normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)";
  const needsSellerEvidence = !isClosed && !isCashTrade && !request.sellerEvidence
    && ["accepted", "payment_sent", "funds_received", "usdt_release_pending"].includes(request.status);
  const hasEvidence = Boolean(request.buyerEvidence || request.sellerEvidence);
  const hasReview = Boolean(request.buyerReview || request.sellerResponse);
  const commissionBlocked = Boolean(sellerWorkspaceSummary?.pendingCommissionCount);
  const dateLocale = isAr ? "ar-IL" : "en-IL";
  const updatedAt = request.updatedAt || request.createdAt;
  const processingLabel = isAr ? "جارٍ التنفيذ..." : "Processing...";

  return (
    <article id={`trade-${request.id}`} className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      <div className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white">{currencyText(shortTradeRef(request, isAr))}</h4>
            <p className="mt-1 break-words text-xs text-[#9CA3AF]">{isAr ? "المشتري" : "Buyer"} {currencyText(safeText(request.buyerName, isAr ? "مشتري" : "Buyer"))}</p>
          </div>
          <span className={`max-w-full rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-4 ${presentation.badgeTone}`}>{currencyText(presentation.badge)}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-base font-semibold tabular-nums">{currencyText(`${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT`)}</p>
          <p className="text-sm tabular-nums">{currencyText(`${toNumber(request.fiatAmount).toLocaleString("en-IL")} ${request.currency}`)}</p>
          <time dateTime={updatedAt} className="ms-auto text-xs text-[#9CA3AF]">{new Date(updatedAt).toLocaleDateString(dateLocale)}</time>
        </div>
        {request.priceMode === "buyer_offer" ? (
          <p className="text-xs font-medium text-[#F4D87A]">{isAr ? "عرض سعر" : "Price offer"} · {currencyText(`₪${toNumber(request.pricePerUsdt).toFixed(2)}`)}/<span className="currency-usdt">USDT</span></p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={isClosed ? "secondary" : "default"} className="min-h-11 min-w-0 flex-1 whitespace-normal px-3 text-center"
            onMouseEnter={() => handlePrefetchTradeRoom(request.id)} onFocus={() => handlePrefetchTradeRoom(request.id)} onClick={() => handleOpenTradeRoom(request.id)}>
            {isClosed ? (isAr ? "عرض غرفة التداول" : "View trade room") : isCashTrade ? (isAr ? "متابعة الصفقة النقدية" : "Continue Cash Trade") : (isAr ? "فتح غرفة التداول" : "Open trade room")}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="min-h-11 gap-1.5 px-3"
            aria-expanded={isExpanded} aria-controls={`seller-trade-details-${request.id}`}
            onClick={() => setSellerExpandedTradeId((previous) => previous === request.id ? null : request.id)}>
            {isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "التفاصيل" : "Details")}
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${isExpanded ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <div id={`seller-trade-details-${request.id}`} className="space-y-2 border-t border-white/10 bg-black/25 p-3 sm:p-4">
          {!isClosed ? <p className="text-xs leading-5 text-[#B6BDC8]">{currencyText(isCashTrade
            ? (isAr ? "افتح الصفقة للخطوة التالية." : "Open the trade for your next step.")
            : paymentMethodTradeInstruction(request.paymentMethod, "seller", isAr))}</p> : null}

          {isPending && isFaceToFace ? (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
              <p className="font-semibold text-[#FDE68A]">{isAr ? "إرشادات الأمان" : "Safety Guidelines"}</p>
              <p className="mt-1 text-[#E5E7EB]">{currencyText(isAr ? "التقيا في أماكن عامة فقط، ويفضل الأماكن المزودة بكاميرات، ولا تشارك معلومات شخصية غير ضرورية، وتأكد من تحويل USDT قبل المغادرة." : "Meet only in public places, prefer camera-covered locations, avoid sharing unnecessary personal details, and confirm USDT transfer before leaving.")}</p>
              <label className="mt-2 inline-flex min-h-11 cursor-pointer items-start gap-2 py-2 text-[#E5E7EB]">
                <input type="checkbox" checked={sellerSafetyAcknowledgements[request.id] ?? false}
                  onChange={(event) => setSellerSafetyAcknowledgements((prev) => ({ ...prev, [request.id]: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]" />
                <span>{isAr ? "قرأت إرشادات الأمان هذه وأوافق عليها." : "I have read and agree to these safety guidelines."}</span>
              </label>
              <Link href="/safety-trust" locale={locale} className="inline-flex min-h-11 items-center text-[#93C5FD] underline underline-offset-2">{isAr ? "مركز الأمان والثقة" : "Safety & Trust Center"}</Link>
            </div>
          ) : null}
          {isPending && request.priceMode === "buyer_offer" ? <TradeTermsPanel key={request.id} request={request} actorId={request.sellerId} isAr={isAr} disabled={Boolean(requestActionKey)} onUpdated={() => handleOpenTradeRoom(request.id)} /> : null}
          {isPending && commissionBlocked ? (
            <div className="rounded-xl border border-yellow-300/30 bg-yellow-300/10 p-3 text-xs text-yellow-200">
              <p>{isAr ? "سدّد العمولة المستحقة لقبول هذا الطلب." : "Settle your outstanding commission to accept this request."}</p>
              <Button type="button" size="sm" variant="secondary" className="mt-2 min-h-11" onClick={reviewPayableCommissions}>{isAr ? "عرض العمولة" : "View commission"}</Button>
            </div>
          ) : null}
          {isPending ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="min-h-11"
                disabled={request.termsProposal?.status === "pending" || commissionBlocked || Boolean(requestActionKey) || (isFaceToFace && !(sellerSafetyAcknowledgements[request.id] ?? false))}
                onClick={() => handleSellerRequestAction(request.id, "accepted", { safetyAcknowledged: sellerSafetyAcknowledgements[request.id] ?? false })}>
                {requestActionKey === `${request.id}:accepted` ? processingLabel : request.priceMode === "buyer_offer" ? (isAr ? "قبول عرض السعر" : "Accept Price Offer") : (isAr ? "قبول" : "Accept")}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="min-h-11" disabled={Boolean(requestActionKey)} onClick={() => handleSellerRequestAction(request.id, "declined")}>
                {requestActionKey === `${request.id}:declined` ? processingLabel : request.priceMode === "buyer_offer" ? (isAr ? "رفض عرض السعر" : "Decline Price Offer") : (isAr ? "رفض" : "Decline")}
              </Button>
            </div>
          ) : null}
          {!isClosed && !isCashTrade && request.status === "payment_sent" ? (
            <Button type="button" size="sm" className="min-h-11" disabled={Boolean(requestActionKey)} onClick={() => handleSellerRequestAction(request.id, "funds_received")}>
              {requestActionKey === `${request.id}:funds_received` ? processingLabel : (isAr ? "تأكيد استلام الأموال" : "Confirm Funds Received")}
            </Button>
          ) : null}
          {!isClosed && !isCashTrade && request.status === "funds_received" ? (
            <Button type="button" size="sm" className="min-h-11" disabled={Boolean(requestActionKey)} onClick={() => handleSellerRequestAction(request.id, "usdt_release_pending")}>
              {currencyText(requestActionKey === `${request.id}:usdt_release_pending` ? processingLabel : (isAr ? "بدء إرسال USDT" : "Start USDT Release"))}
            </Button>
          ) : null}
          {!isClosed && !isCashTrade && request.status === "usdt_release_pending" ? (
            <Button type="button" size="sm" className="min-h-11" disabled={!request.sellerEvidence || Boolean(requestActionKey)} onClick={() => handleSellerRequestAction(request.id, "usdt_sent")}>
              {currencyText(requestActionKey === `${request.id}:usdt_sent` ? processingLabel : (isAr ? "تحديد USDT كمُرسل" : "Mark USDT Sent"))}
            </Button>
          ) : null}
          {needsSellerEvidence ? (
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <p className="text-sm font-medium text-white">{isAr ? "رفع إثبات البائع" : "Upload seller evidence"}</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">{currencyText(isAr ? "مطلوب قبل تحديد USDT كمُرسل." : "Required before marking USDT sent.")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <LocalizedEvidenceFileInput id={`seller-evidence-file-${request.id}`} isAr={isAr} selectedFile={sellerEvidenceFiles[request.id] ?? null}
                  onSelect={(file) => setSellerEvidenceFiles((prev) => ({ ...prev, [request.id]: file }))} />
                <Button type="button" size="sm" variant="secondary" className="min-h-11" disabled={!sellerEvidenceFiles[request.id] || evidenceUploading[`${request.id}:seller`]}
                  onClick={() => { const file = sellerEvidenceFiles[request.id]; if (file) void uploadTradeEvidenceFile(request.id, "seller", file); }}>
                  {evidenceUploading[`${request.id}:seller`] ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                </Button>
              </div>
            </div>
          ) : null}

          <HelpDetails title={isAr ? "بيانات الصفقة" : "Trade details"}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs [&_dt]:text-[#9CA3AF] [&_dd]:mt-0.5 [&_dd]:break-words [&_dd]:text-white">
              <div className="col-span-2"><dt>{isAr ? "طريقة الدفع" : "Payment method"}</dt><dd>{currencyText(paymentMethodEmoji(request.paymentMethod))} {currencyText(paymentMethodLabel(request.paymentMethod, isAr))}</dd></div>
              <div><dt>{isAr ? "الشبكة" : "Network"}</dt><dd>{request.network}</dd></div>
              <div><dt>{currencyText(isAr ? "السعر لكل USDT" : "Price per USDT")}</dt><dd>{currencyText(`₪${(toNumber(request.pricePerUsdt) || (toNumber(request.fiatAmount) / Math.max(1, toNumber(request.usdtAmount)))).toFixed(2)}`)}</dd></div>
              {request.priceMode === "buyer_offer" ? <div><dt>{isAr ? "سعر العرض الأصلي" : "Original listing price"}</dt><dd>{currencyText(`₪${toNumber(request.listingPriceAtRequest).toFixed(2)}`)}</dd></div> : null}
              <div><dt>{isAr ? "العرض" : "Listing"}</dt><dd>{currencyText(shortListingRef({ id: request.listingId, displayNumber: myListingsById.get(request.listingId)?.displayNumber }))}</dd></div>
              <div><dt>{isAr ? "تاريخ الإرسال" : "Submitted"}</dt><dd>{new Date(request.createdAt).toLocaleString(dateLocale)}</dd></div>
              {request.completedAt ? <div><dt>{isAr ? "اكتملت" : "Completed"}</dt><dd>{new Date(request.completedAt).toLocaleString(dateLocale)}</dd></div> : null}
              {request.reviewUnlockedAt ? <div><dt>{isAr ? "تم فتح التقييم" : "Review unlocked"}</dt><dd>{new Date(request.reviewUnlockedAt).toLocaleString(dateLocale)}</dd></div> : null}
              <div><dt>{isAr ? "آخر تحديث" : "Last updated"}</dt><dd>{new Date(updatedAt).toLocaleString(dateLocale)}</dd></div>
            </dl>
          </HelpDetails>
          {hasEvidence ? (
            <HelpDetails title={isAr ? "إثباتات الدفع" : "Payment evidence"}>
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                {(["buyer", "seller"] as const).map((side) => {
                  const evidence = side === "buyer" ? request.buyerEvidence : request.sellerEvidence;
                  return <div key={side} className="min-w-0">
                    <p className="font-medium text-white">{side === "buyer" ? (isAr ? "إثبات المشتري" : "Buyer evidence") : (isAr ? "إثبات البائع" : "Seller evidence")}</p>
                    {evidence ? <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${evidence.id}`} target="_blank" rel="noreferrer"
                      className="inline-flex min-h-11 max-w-full items-center break-all text-[#C9A227] underline underline-offset-2">{currencyText(evidence.fileName)}</a>
                      : <p className="mt-1 text-[#9CA3AF]">{isAr ? "لا يوجد إثبات مرفق." : "No evidence attached."}</p>}
                  </div>;
                })}
              </div>
            </HelpDetails>
          ) : null}
          {request.timeline?.length ? <HelpDetails title={isAr ? "سجل النشاط" : "Activity history"}><CompactTradeTimeline events={request.timeline} isAr={isAr} /></HelpDetails> : null}
          {hasReview ? (
            <HelpDetails title={isAr ? "التقييم والرد" : "Review & response"}>
              {request.buyerReview ? <div className="text-xs"><p className="font-medium text-white">{isAr ? "تقييم المشتري" : "Buyer review"}</p><p className="mt-1 whitespace-pre-wrap break-words">{currencyText(request.buyerReview.comment)}</p></div> : null}
              {request.buyerReview && !request.sellerResponse ? (
                <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void handleSubmitSellerResponse(request); }}>
                  <Textarea aria-label={isAr ? "الرد على تقييم المشتري" : "Respond to buyer review"} placeholder={isAr ? "اكتب ردك على تقييم المشتري" : "Respond to buyer review"}
                    value={sellerResponseDrafts[request.id] ?? ""} onChange={(event) => setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                  <Button type="submit" size="sm" variant="secondary" className="min-h-11 justify-self-start">{isAr ? "إرسال الرد" : "Submit response"}</Button>
                </form>
              ) : null}
              {request.sellerResponse ? <div className="text-xs"><p className="font-medium text-white">{isAr ? "رد البائع" : "Seller response"}</p><p className="mt-1 whitespace-pre-wrap break-words">{currencyText(request.sellerResponse.message)}</p></div> : null}
            </HelpDetails>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
