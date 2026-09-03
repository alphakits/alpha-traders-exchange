"use client";

import type { FormEventHandler } from "react";
import { AlertTriangle, BadgePercent, HandCoins, Loader2, ShieldCheck, Star, X, Zap } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/role-badge";
import { getIsraeliBankDisplayName, parseIsraeliBankSelection } from "@/lib/israeli-banks";
import { isBankTransferPaymentMethod, isCardlessAtmPaymentMethod } from "@/lib/marketplace-payment-methods";
import { deriveSellerPresence } from "@/lib/seller-presence";
import { formatTradeId } from "@/lib/format-id";
import { cn } from "@/lib/utils";
import type { AuditAction, MarketplaceListing, PremiumSellerProfileData, PurchaseRequest, SellerLevel } from "@/types/alpha-exchange";

type Locale = "ar" | "en";

type BuyerInfo = {
  usdtAmount: string;
  receivingWalletAddress: string;
};

type PurchaseListingDialogProps = {
  locale: Locale;
  listing: MarketplaceListing;
  sellerProfileData: PremiumSellerProfileData | null;
  isSellerProfileLoading: boolean;
  selectedAmount: number;
  selectedPrice: number;
  commission: number;
  estimatedTotal: number;
  isOwnerViewer: boolean;
  isOwnerProfileActionLoading: boolean;
  purchaseSubmitted: boolean;
  buyerInfo: BuyerInfo;
  selectedPaymentMethods: string[];
  selectedPaymentMethod: string | null;
  buyerTradeAmount: number;
  selectedMinTrade: number;
  selectedMaxTrade: number;
  buyerTradeAmountInvalid: boolean;
  buyerWalletValidationError: string | null;
  buyerWalletInvalid: boolean;
  priceMode: "listing_price" | "buyer_offer";
  offeredPrice: string;
  minimumOfferedPrice: string;
  offerPriceInvalid: boolean;
  offeredTradePrice: number;
  requiresSafetyNotice: boolean;
  safetyAcknowledged: boolean;
  showVerificationCta: boolean;
  isRedirectingToVerification: boolean;
  statusMessage: string | null;
  isSubmittingPurchase: boolean;
  onClose: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onQuickBuy: () => void;
  onPaymentMethodChange: (method: string) => void;
  onBuyerAmountChange: (value: string) => void;
  onBuyerWalletChange: (value: string) => void;
  onOfferedPriceChange: (value: string) => void;
  onSafetyAcknowledgedChange: (value: boolean) => void;
  onGoToVerification: () => void;
  onOwnerSellerProfileState: (
    sellerId: string,
    state: { feature?: boolean; hidden?: boolean },
    successMessage: string,
  ) => void;
  onOwnerSuspendSeller: (sellerId: string) => void;
  formatIls: (value: number) => string;
  formatIntegerForInput: (value: string | number | null | undefined) => string;
  localizedAuditAction: (action: AuditAction | string, isAr: boolean) => string;
  paymentMethodEmoji: (method: string) => string;
  paymentMethodLabel: (method: string, isAr?: boolean) => string;
  sellerLevelLabel: (level?: SellerLevel, isAr?: boolean) => string;
  sellerLevelToneKey: (level?: SellerLevel) => string;
  tradeStatusLabel: (status: PurchaseRequest["status"], isAr?: boolean) => string;
};

function safeText(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function selectedMethodUsesBanks(method: string | null | undefined) {
  return isBankTransferPaymentMethod(method) || isCardlessAtmPaymentMethod(method);
}

function shortTradeRef(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id">) {
  return `Trade ${formatTradeId(request.displayNumber, request.tradeId ?? request.id)}`;
}

export function PurchaseListingDialog({
  locale,
  listing,
  sellerProfileData,
  isSellerProfileLoading,
  selectedAmount,
  selectedPrice,
  commission,
  estimatedTotal,
  isOwnerViewer,
  isOwnerProfileActionLoading,
  purchaseSubmitted,
  buyerInfo,
  selectedPaymentMethods,
  selectedPaymentMethod,
  buyerTradeAmount,
  selectedMinTrade,
  selectedMaxTrade,
  buyerTradeAmountInvalid,
  buyerWalletValidationError,
  buyerWalletInvalid,
  priceMode,
  offeredPrice,
  minimumOfferedPrice,
  offerPriceInvalid,
  offeredTradePrice,
  requiresSafetyNotice,
  safetyAcknowledged,
  showVerificationCta,
  isRedirectingToVerification,
  statusMessage,
  isSubmittingPurchase,
  onClose,
  onSubmit,
  onQuickBuy,
  onPaymentMethodChange,
  onBuyerAmountChange,
  onBuyerWalletChange,
  onOfferedPriceChange,
  onSafetyAcknowledgedChange,
  onGoToVerification,
  onOwnerSellerProfileState,
  onOwnerSuspendSeller,
  formatIls,
  formatIntegerForInput,
  localizedAuditAction,
  paymentMethodEmoji,
  paymentMethodLabel,
  sellerLevelLabel,
  sellerLevelToneKey,
  tradeStatusLabel,
}: PurchaseListingDialogProps) {
  const isAr = locale === "ar";
  const purchaseDisabled = isSubmittingPurchase
    || buyerTradeAmountInvalid
    || buyerWalletInvalid
    || (priceMode === "buyer_offer" && offerPriceInvalid)
    || (requiresSafetyNotice && !safetyAcknowledged);

  const modalPresence = deriveSellerPresence({
    onlineStatus: (sellerProfileData?.profile ?? listing.sellerProfile)?.onlineStatus,
    lastActiveAt: (sellerProfileData?.profile ?? listing.sellerProfile)?.lastActiveAt,
  });
  const modalName = sellerProfileData?.profile.sellerName ?? listing.sellerDisplayName;
  const modalLevel = sellerProfileData?.sellerLevel ?? listing.sellerReputation?.level;
  const modalToneKey = listing.sellerProfile?.isOwner ? "legendary" : sellerLevelToneKey(modalLevel);
  const modalTrust = sellerProfileData?.trustScore ?? listing.sellerReputation?.trustScore ?? 0;
  const modalResponse = sellerProfileData?.responseTimeMinutes ?? listing.sellerReputation?.responseTimeMinutes ?? 0;
  const modalCompleted = sellerProfileData?.completedTrades ?? listing.sellerReputation?.completedTrades ?? 0;
  const modalRating = sellerProfileData?.averageRating ?? listing.sellerReputation?.rating ?? 0;
  const modalPhoto = sellerProfileData?.profile.profilePhotoUrl ?? listing.sellerProfile?.profilePhotoUrl;

  return (
    <div className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={priceMode === "buyer_offer" ? (isAr ? "تقديم عرض سعر" : "Make a Price Offer") : (isAr ? "شراء USDT" : "Buy USDT")} className="alpha-modal-panel flex max-h-[92vh] w-full max-w-[700px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0B0B0B]/95 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className={`flex shrink-0 items-start justify-between gap-3 px-5 pt-5 sm:px-6 ${isAr ? "flex-row-reverse" : ""}`}>
          <div>
            <h3 className="text-2xl font-semibold">{priceMode === "buyer_offer" ? (isAr ? "قدّم عرض سعر" : "Make a Price Offer") : (isAr ? "شراء USDT" : "Buy USDT")}</h3>
            <p className={`mt-1 inline-flex items-center gap-1.5 text-xs text-[#C9A227] ${isAr ? "flex-row-reverse" : ""}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{priceMode === "buyer_offer" ? (isAr ? "اختر سعرك · قبول البائع مطلوب" : "Choose your price · seller approval required") : (isAr ? "صفقة منظّمة · تسوية مباشرة" : "Structured trade · direct settlement")}</span>
            </p>
          </div>
          <button type="button" aria-label={priceMode === "buyer_offer" ? (isAr ? "إغلاق نافذة عرض السعر" : "Close price offer sheet") : (isAr ? "إغلاق نافذة شراء USDT" : "Close Buy USDT sheet")} onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!purchaseSubmitted ? (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-4 sm:px-6">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  {modalPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={modalPhoto} alt={isAr ? `صورة ${safeText(modalName, "البائع")}` : `${safeText(modalName, "Seller")} profile`} className="h-12 w-12 shrink-0 rounded-full border border-white/15 object-cover" />
                  ) : (
                    <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white">
                      {safeText(modalName, isAr ? "بائع" : "Seller").split(" ").map((part) => part[0]).join("").slice(0, 2)}
                    </div>
                  )}
                  <div className={`min-w-0 flex-1 ${isAr ? "text-right" : ""}`}>
                    <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                      <p className={cn("truncate text-base font-semibold", listing.sellerProfile?.isOwner ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${modalToneKey}`)}>{safeText(modalName, isAr ? "بائع" : "Seller")}</p>
                      <RoleBadge variant="approved_seller" locale={locale} className={cn("seller-rank-badge", `seller-rank-badge--${modalToneKey}`)} />
                      <span className={cn("seller-rank-pill", `seller-rank-pill--${modalToneKey}`)}>
                        {listing.sellerProfile?.isOwner ? (isAr ? "بائع أسطوري" : "Legendary Seller") : (isAr ? `بائع ${sellerLevelLabel(modalLevel, true)}` : `${sellerLevelLabel(modalLevel)} Seller`)}
                      </span>
                    </div>
                    <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#9CA3AF] ${isAr ? "flex-row-reverse" : ""}`}>
                      <span className={cn("inline-flex items-center gap-1", `seller-presence--${modalPresence.tone}`)}>
                        <span className={cn("seller-presence-dot", `seller-presence-dot--${modalPresence.tone}`)} aria-hidden="true" />
                        {isAr ? modalPresence.labelAr : modalPresence.label}
                      </span>
                      <span><ShieldCheck className="mr-0.5 inline h-3 w-3 text-[#93C5FD]" />{modalTrust.toFixed(1)}</span>
                      <span><Zap className="me-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalResponse.toFixed(0)} {isAr ? "دقائق" : "min"}</span>
                      <span><HandCoins className="me-0.5 inline h-3 w-3" />{modalCompleted.toLocaleString("en-IL")} {isAr ? "صفقات" : "trades"}</span>
                      <span><Star className="mr-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalRating.toFixed(2)}</span>
                      {isSellerProfileLoading && !sellerProfileData ? <span className="text-[10px] italic text-[#9CA3AF]">{isAr ? "جارٍ التحديث…" : "refreshing…"}</span> : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#C9A227]/25 bg-gradient-to-r from-emerald-500/10 via-black/50 to-[#C9A227]/12 p-3">
                <div className={`flex items-end justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <div className={isAr ? "text-right" : ""}>
                    <p className="text-2xl font-bold leading-none text-white">{selectedAmount.toLocaleString("en-IL")}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-emerald-200/90">{isAr ? "USDT متاح" : "USDT Available"}</p>
                  </div>
                  <div className={isAr ? "text-left" : "text-right"}>
                    <p className="text-2xl font-bold leading-none text-[#C9A227]">{priceMode === "buyer_offer" && offeredTradePrice <= 0 ? "—" : formatIls(priceMode === "buyer_offer" ? offeredTradePrice : selectedPrice)}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#D1D5DB]">{priceMode === "buyer_offer" ? (isAr ? "سعرك المقترح" : "Your offered price") : (isAr ? "سعر العرض" : "Listing price")} · ILS / USDT</p>
                    {priceMode === "buyer_offer" ? <p className="mt-1 text-[10px] text-[#9CA3AF]">{isAr ? "سعر البائع" : "Seller price"}: {formatIls(selectedPrice)}</p> : null}
                  </div>
                </div>
                <p className={`mt-2 text-[11px] text-[#9CA3AF] ${isAr ? "text-right" : ""}`}>
                  {isAr ? "العمولة (1%)" : "Commission (1%)"}: <span className="text-white">₪{commission.toFixed(2)}</span> · {isAr ? "الإجمالي التقديري" : "Estimated total"}: <span className="text-[#C9A227]">₪{estimatedTotal.toFixed(2)}</span>
                </p>
              </div>

              {isOwnerViewer && sellerProfileData ? (
                <div className="rounded-2xl border border-[#C9A227]/25 bg-black/25 p-4 text-sm text-[#D1D5DB]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "أدوات المالك" : "Owner Tools"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => onOwnerSellerProfileState(sellerProfileData.sellerId, { feature: !sellerProfileData.profile.isFeaturedSeller }, sellerProfileData.profile.isFeaturedSeller ? (isAr ? "تمت إزالة البائع من المميزين." : "Seller unfeatured.") : (isAr ? "تم تمييز البائع." : "Seller featured."))}>
                      {sellerProfileData.profile.isFeaturedSeller ? (isAr ? "إلغاء تمييز البائع" : "Unfeature Seller") : (isAr ? "تمييز البائع" : "Feature Seller")}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => onOwnerSellerProfileState(sellerProfileData.sellerId, { hidden: !sellerProfileData.profile.isProfileHidden }, sellerProfileData.profile.isProfileHidden ? (isAr ? "تم إظهار ملف البائع." : "Seller profile unhidden.") : (isAr ? "تم إخفاء ملف البائع." : "Seller profile hidden."))}>
                      {sellerProfileData.profile.isProfileHidden ? (isAr ? "إظهار البائع" : "Unhide Seller") : (isAr ? "إخفاء البائع" : "Hide Seller")}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => onOwnerSuspendSeller(sellerProfileData.sellerId)}>
                      {isAr ? "تعليق البائع" : "Suspend Seller"}
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs"><p className="font-medium text-white">{isAr ? "سجل التدقيق" : "Audit History"}</p><p className="mt-1">{sellerProfileData.ownerTools?.auditHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs"><p className="font-medium text-white">{isAr ? "سجل العمولات" : "Commission History"}</p><p className="mt-1">{sellerProfileData.ownerTools?.commissionHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs"><p className="font-medium text-white">{isAr ? "سجل الصفقات" : "Trade History"}</p><p className="mt-1">{sellerProfileData.ownerTools?.tradeHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p></div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{isAr ? "أحدث عمليات التدقيق" : "Recent Audit"}</p>
                      {(sellerProfileData.ownerTools?.auditHistory ?? []).slice(0, 3).map((entry) => <p key={entry.id} className="mt-1">{localizedAuditAction(entry.action, isAr)} • {new Date(entry.createdAt).toLocaleDateString(isAr ? "ar-IL-u-nu-latn" : "en-IL")}</p>)}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{isAr ? "أحدث العمولات" : "Recent Commission"}</p>
                      {(sellerProfileData.ownerTools?.commissionHistory ?? []).slice(0, 3).map((entry) => <p key={entry.id} className="mt-1">{entry.commissionAmount.toFixed(2)} USDT • {new Date(entry.createdAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</p>)}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{isAr ? "أحدث الصفقات" : "Recent Trades"}</p>
                      {(sellerProfileData.ownerTools?.tradeHistory ?? []).slice(0, 3).map((entry) => <p key={entry.id} className="mt-1">{shortTradeRef(entry)} • {tradeStatusLabel(entry.status, isAr)}</p>)}
                    </div>
                  </div>
                </div>
              ) : null}

              <form id="buy-usdt-form" className="grid gap-3" onSubmit={onSubmit}>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اختر طريقة الدفع" : "Choose payment method"}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {selectedPaymentMethods.map((method) => {
                      const selected = selectedPaymentMethod === method;
                      return (
                        <button key={`purchase-method-${listing.id}-${method}`} type="button" onClick={() => onPaymentMethodChange(method)} className={`rounded-xl border p-3 transition-all duration-200 ${isAr ? "text-right" : "text-left"} ${selected ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]" : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"}`}>
                          <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                          {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "مختارة لهذه الصفقة" : "Selected for this trade"}</p> : null}
                        </button>
                      );
                    })}
                  </div>
                  {selectedMethodUsesBanks(selectedPaymentMethod) && parseIsraeliBankSelection(listing.bankName).length ? (
                    <p className="mt-3 text-xs text-[#D1D5DB]">{isAr ? "البنوك المدعومة" : "Supported banks"}: <span className="text-white">{parseIsraeliBankSelection(listing.bankName).map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</span></p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-3">
                    <label htmlFor="buyer-usdt-amount" className="text-sm font-medium text-white">{isAr ? "كمية USDT" : "USDT Amount"} <span className="text-red-300">*</span></label>
                    <Input id="buyer-usdt-amount" dir="ltr" inputMode="numeric" placeholder={isAr ? "أدخل الكمية" : "Enter amount"} value={buyerInfo.usdtAmount} onChange={(event) => onBuyerAmountChange(formatIntegerForInput(event.target.value))} className={`text-left ${buyerTradeAmountInvalid ? "border-red-500/80" : buyerTradeAmount > 0 ? "border-emerald-500/70" : ""}`} aria-invalid={buyerTradeAmountInvalid || undefined} aria-describedby="buyer-amount-help" />
                    <p id="buyer-amount-help" className={`text-xs ${buyerTradeAmountInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>{buyerTradeAmountInvalid ? "⚠ " : ""}{isAr ? "حدود الصفقة" : "Trade limits"}: {selectedMinTrade.toLocaleString("en-IL")} - {selectedMaxTrade.toLocaleString("en-IL")} USDT</p>
                  </div>
                  {priceMode === "buyer_offer" ? (
                    <div className="space-y-2 md:col-span-3">
                      <label htmlFor="buyer-offered-price" className="inline-flex items-center gap-2 text-sm font-medium text-white">
                        <BadgePercent className="h-4 w-4 text-[#F4D87A]" />
                        {isAr ? "سعرك لكل USDT" : "Your Price per USDT"} <span className="text-red-300">*</span>
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[#F4D87A]">₪</span>
                        <Input
                          id="buyer-offered-price"
                          dir="ltr"
                          type="number"
                          inputMode="decimal"
                          min={minimumOfferedPrice}
                          max={Math.max(0.01, selectedPrice - 0.01).toFixed(2)}
                          step="0.01"
                          autoComplete="off"
                          placeholder={minimumOfferedPrice || "0.00"}
                          value={offeredPrice}
                          onChange={(event) => onOfferedPriceChange(event.target.value)}
                          className={`pl-7 text-left ${offerPriceInvalid ? "border-red-500/80" : offeredPrice ? "border-emerald-500/70" : ""}`}
                          aria-invalid={offerPriceInvalid || undefined}
                          aria-describedby="buyer-offer-price-help"
                        />
                      </div>
                      <p id="buyer-offer-price-help" className={`text-xs ${offerPriceInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>
                        {offerPriceInvalid ? "⚠ " : ""}{isAr
                          ? `اختر سعراً من ₪${minimumOfferedPrice} إلى أقل من ₪${selectedPrice.toFixed(2)}. الحد الأقصى للخصم هو ₪0.35.`
                          : `Choose from ₪${minimumOfferedPrice} to below ₪${selectedPrice.toFixed(2)}. Maximum discount is ₪0.35.`}
                      </p>
                    </div>
                  ) : null}
                  <div className="space-y-2 md:col-span-3">
                    <label htmlFor="buyer-receiving-wallet" className="text-sm font-medium text-white">{isAr ? "عنوان محفظة الاستلام" : "Receiving Wallet Address"} <span className="text-red-300">*</span></label>
                    <Input id="buyer-receiving-wallet" dir="ltr" required autoComplete="off" spellCheck={false} placeholder={isAr ? `عنوان محفظة ${listing.network}` : `${listing.network} wallet address`} value={buyerInfo.receivingWalletAddress} onChange={(event) => onBuyerWalletChange(event.target.value)} className={`text-left font-mono ${buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "border-red-500/80" : ""}`} aria-describedby="buyer-wallet-guidance" aria-invalid={buyerInfo.receivingWalletAddress ? buyerWalletInvalid : undefined} />
                    <p id="buyer-wallet-guidance" className={`text-xs ${buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>
                      {buyerInfo.receivingWalletAddress && buyerWalletValidationError ? buyerWalletValidationError : isAr ? `أدخل العنوان الذي تريد استلام USDT عليه عبر شبكة ${listing.network}. سيبقى مخفياً عن البائع حتى تحدد أن الدفع تم إرساله.` : `Enter the address where you want to receive USDT on ${listing.network}. It stays hidden from the seller until you mark payment as sent.`}
                    </p>
                  </div>
                </div>
                {requiresSafetyNotice ? (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "إرشادات الأمان" : "Safety Guidelines"}</p>
                    <ul className="mt-1 list-disc space-y-1 ps-4 text-[#E5E7EB]">
                      <li>{isAr ? "التقِ في الأماكن العامة فقط." : "Meet only in public places."}</li><li>{isAr ? "اختر مكاناً توجد فيه كاميرات مراقبة." : "Prefer locations with security cameras."}</li><li>{isAr ? "التقِ خلال النهار قدر الإمكان." : "Meet during daylight when possible."}</li><li>{isAr ? "لا تكشف معلومات شخصية غير ضرورية." : "Do not reveal unnecessary personal information."}</li><li>{isAr ? "تأكد من تحويل USDT قبل المغادرة." : "Confirm the USDT transfer before leaving."}</li><li>{isAr ? "أبلغ فوراً عن أي سلوك مشبوه." : "Report suspicious behavior immediately."}</li>
                    </ul>
                    <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]"><input type="checkbox" checked={safetyAcknowledged} onChange={(event) => onSafetyAcknowledgedChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]" /><span>{isAr ? "قرأت إرشادات الخصوصية والأمان وفهمتها." : "I have read and understand the privacy and safety guidelines."}</span></label>
                    <p className="mt-1 text-[#D1D5DB]">{isAr ? "يجب على المشتري والبائع تأكيد هذه الإرشادات قبل بدء الصفقة." : "Both buyer and seller must acknowledge these guidelines before the trade can begin."}</p>
                    <p className="mt-1 text-[#D1D5DB]">{isAr ? <>اقرأ الإرشادات كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                  </div>
                ) : null}
                {showVerificationCta ? (
                  <Card className="border-[#C9A227]/50 bg-gradient-to-br from-amber-500/15 via-black/60 to-[#C9A227]/10 shadow-[0_0_26px_rgba(201,162,39,0.22)]"><CardContent className="space-y-3 p-4"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-[#FDE68A]" /><div><p className="text-sm font-semibold text-[#FDE68A]">{isAr ? "⚠️ توثيق المشتري مطلوب" : "⚠️ Buyer Verification Required"}</p><p className="mt-1 text-xs text-[#E5E7EB]">{isAr ? "أكمل التوثيق لبدء التداول بأمان على Alpha Exchange. تستغرق العملية أقل من دقيقة." : "Complete your verification to begin trading safely on Alpha Exchange. The verification takes less than one minute."}</p></div></div><div className="flex flex-col gap-2 sm:flex-row"><Button type="button" className="w-full sm:w-auto" onClick={onGoToVerification} disabled={isRedirectingToVerification}>{isRedirectingToVerification ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}{isRedirectingToVerification ? (isAr ? "جارٍ الانتقال إلى التوثيق..." : "Redirecting to verification...") : (isAr ? "✅ وثّق الآن" : "✅ Verify Now")}</Button><button type="button" onClick={onGoToVerification} disabled={isRedirectingToVerification} className={`${isAr ? "text-right" : "text-left"} text-xs text-[#FDE68A] underline underline-offset-2 transition hover:text-[#FFE8A3] disabled:cursor-not-allowed disabled:opacity-70`}>{isAr ? "الانتقال إلى التوثيق ←" : "Go to Verification →"}</button></div></CardContent></Card>
                ) : null}
                {statusMessage && !showVerificationCta ? <Card className="border-amber-500/30 bg-black/30"><CardContent className="flex items-center gap-2 p-3 text-xs text-[#FDE68A]"><AlertTriangle className="h-3.5 w-3.5" /><span>{statusMessage}</span></CardContent></Card> : null}
              </form>
            </div>
            <div className="shrink-0 border-t border-white/10 bg-[#0B0B0B]/95 px-5 py-3 sm:px-6 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
              <div className={`grid gap-2 ${priceMode === "buyer_offer" ? "" : "md:grid-cols-2"}`}>
                <Button type="submit" form="buy-usdt-form" className="min-h-11 w-full" disabled={purchaseDisabled}>{isSubmittingPurchase ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}{isSubmittingPurchase ? (isAr ? "جارٍ الإرسال..." : "Submitting...") : priceMode === "buyer_offer" ? (isAr ? "إرسال عرض السعر" : "Submit Price Offer") : (isAr ? "بدء الصفقة" : "Start Trade")}</Button>
                {priceMode !== "buyer_offer" ? <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={purchaseDisabled} onClick={onQuickBuy}>{isSubmittingPurchase ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}{isSubmittingPurchase ? (isAr ? "جارٍ الإرسال..." : "Submitting...") : (isAr ? "شراء سريع" : "Quick Buy")}</Button> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 pb-5 pt-4 sm:px-6"><div className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm"><p className="text-base font-semibold text-white">{priceMode === "buyer_offer" ? (isAr ? "تم إرسال عرض السعر" : "Price Offer Submitted") : (isAr ? "تم إرسال الطلب" : "Request Submitted")}</p><p className="mt-2 text-[#D1D5DB]">{priceMode === "buyer_offer" ? (isAr ? "تم إرسال سعرك إلى البائع. ستبدأ الصفقة بالسعر المتفق عليه إذا وافق البائع." : "Your price was sent to the seller. If accepted, the trade will continue at the agreed price.") : (isAr ? "استلمت Alpha Traders طلبك. سنربطك بالبائع المعتمد قريباً." : "Alpha Traders has received your request. We will connect you with the Approved Seller shortly.")}</p><div className="mt-4"><Button onClick={onClose}>{isAr ? "إغلاق" : "Close"}</Button></div></div></div>
        )}
      </div>
    </div>
  );
}
