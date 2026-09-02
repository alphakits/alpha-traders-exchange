"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Copy, Edit3, PauseCircle, PlayCircle, Store, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DiscordShareAction, type DiscordListingSharingStatus } from "@/components/sections/usdt-exchange/discord-share-action";
import { sellerListingWorkspaceAnchor } from "@/lib/action-destinations";
import { getIsraeliBankDisplayName, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { MARKETPLACE_PAYMENT_METHODS, MAX_LISTING_PAYMENT_METHODS, type MarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { LISTING_CHANGE_REASONS } from "@/lib/listing-change-reasons";
import { cn } from "@/lib/utils";
import type { MarketplaceListing, PurchaseRequest, SupportedNetwork } from "@/types/alpha-exchange";
import type { SellerBankAccount } from "@/components/sections/usdt-exchange/usdt-exchange-page";

type ListingEditForm = {
  availableAmount: string;
  price: string;
  currency: string;
  network: SupportedNetwork;
  paymentMethods: string[];
  bankAccountId: string;
  bankName: string;
  minimumTrade: string;
  maximumTrade: string;
  sellerDescription: string;
  changeReason: string;
  changeExplanation: string;
};

type ListingEditOriginal = {
  availableAmount: string;
  price: string;
  minimumTrade: string;
  maximumTrade: string;
};

export type SellerListingsWorkspacePortalProps = {
  discordShareActionKey: string | null;
  discordSharing: DiscordListingSharingStatus | null;
  editingListingId: string | null;
  handleDiscordListingShare: (listing: MarketplaceListing) => Promise<void>;
  handleSellerListingDelete: (listing: MarketplaceListing) => Promise<void>;
  handleSellerListingDuplicate: (listing: MarketplaceListing) => Promise<void>;
  handleSellerListingEditSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSellerListingRenew: (listing: MarketplaceListing) => Promise<void>;
  handleSellerListingStatus: (listing: MarketplaceListing, nextStatus: "active" | "paused") => Promise<void>;
  isAr: boolean;
  isListingActionBusy: (listingId: string) => boolean;
  isListingEditSubmitDisabled: boolean;
  isMobileViewport: boolean;
  isWorkspaceWidgetsLoading: boolean;
  listingActionKey: string | null;
  listingEditAmount: number;
  listingEditForm: ListingEditForm;
  listingEditGuardTone: string;
  listingEditNeedsReason: boolean;
  listingEditPriceInvalid: boolean;
  listingEditPriceValid: boolean;
  listingEditReasonValid: boolean;
  listingEditRequiresBank: boolean;
  listingEditRequiresBankAccount: boolean;
  listingEditSelectedBanks: string[];
  listingEditSelectedMethods: MarketplacePaymentMethod[];
  listingEditTradeRangeInvalid: boolean;
  locale: "ar" | "en";
  marketPricePerUsdt: number;
  maxAllowedListingPrice: number;
  myListings: MarketplaceListing[];
  scrollToCreateListingSection: () => boolean;
  sellerBankAccounts: SellerBankAccount[];
  sellerBankAccountsLoading: boolean;
  sellerDashboardListingsTarget: HTMLDivElement | null;
  sellerExpandedListingId: string | null;
  sellerListingsExpanded: boolean;
  sellerRequests: PurchaseRequest[];
  setEditingListingId: Dispatch<SetStateAction<string | null>>;
  setListingEditForm: Dispatch<SetStateAction<ListingEditForm>>;
  setListingEditOriginal: Dispatch<SetStateAction<ListingEditOriginal | null>>;
  setSellerExpandedListingId: Dispatch<SetStateAction<string | null>>;
  setSellerListingsExpanded: Dispatch<SetStateAction<boolean>>;
  shortListingRef: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").shortListingRef;
  sortedDashboardListings: MarketplaceListing[];
  ISRAELI_BANKS: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").ISRAELI_BANKS;
  formatIls: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatIls;
  formatIntegerForInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatIntegerForInput;
  listingChangeReasonLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").listingChangeReasonLabel;
  listingStatusLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").listingStatusLabel;
  normalizeDecimalInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").normalizeDecimalInput;
  normalizePaymentMethodList: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").normalizePaymentMethodList;
  paymentMethodEmoji: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodEmoji;
  paymentMethodLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodLabel;
  renderBankLogo: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").renderBankLogo;
  requiresBankSelection: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").requiresBankSelection;
  toNumber: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").toNumber;
  toggleSelection: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").toggleSelection;
};

export function SellerListingsWorkspacePortal(props: SellerListingsWorkspacePortalProps) {
  const {
    discordShareActionKey,
    discordSharing,
    editingListingId,
    handleDiscordListingShare,
    handleSellerListingDelete,
    handleSellerListingDuplicate,
    handleSellerListingEditSubmit,
    handleSellerListingRenew,
    handleSellerListingStatus,
    isAr,
    isListingActionBusy,
    isListingEditSubmitDisabled,
    isMobileViewport,
    isWorkspaceWidgetsLoading,
    listingActionKey,
    listingEditAmount,
    listingEditForm,
    listingEditGuardTone,
    listingEditNeedsReason,
    listingEditPriceInvalid,
    listingEditPriceValid,
    listingEditReasonValid,
    listingEditRequiresBank,
    listingEditRequiresBankAccount,
    listingEditSelectedBanks,
    listingEditSelectedMethods,
    listingEditTradeRangeInvalid,
    locale,
    marketPricePerUsdt,
    maxAllowedListingPrice,
    myListings,
    scrollToCreateListingSection,
    sellerBankAccounts,
    sellerBankAccountsLoading,
    sellerDashboardListingsTarget,
    sellerExpandedListingId,
    sellerListingsExpanded,
    sellerRequests,
    setEditingListingId,
    setListingEditForm,
    setListingEditOriginal,
    setSellerExpandedListingId,
    setSellerListingsExpanded,
    shortListingRef,
    sortedDashboardListings,
    ISRAELI_BANKS,
    formatIls,
    formatIntegerForInput,
    listingChangeReasonLabel,
    listingStatusLabel,
    normalizeDecimalInput,
    normalizePaymentMethodList,
    paymentMethodEmoji,
    paymentMethodLabel,
    renderBankLogo,
    requiresBankSelection,
    toNumber,
    toggleSelection,
  } = props;

  return (() => {
          const sellerListingsWorkspace = (
          <Card
            id="my-listings-section"
            tabIndex={-1}
            className="scroll-mt-24 border-white/10 bg-[#0B0B0B]/90"
          >
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>{isAr ? "قائمتي" : "My Listings"}</CardTitle>
                  <CardDescription>{isAr ? "إدارة جميع عروضك كبائع معتمد." : "Manage all of your approved seller listings."}</CardDescription>
                </div>
                {sortedDashboardListings.length ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 w-full sm:w-auto"
                    onClick={() => {
                      const newestListing = sortedDashboardListings[0];
                      setSellerListingsExpanded(true);
                      setSellerExpandedListingId(newestListing?.id ?? null);
                      window.requestAnimationFrame(() => {
                        if (!newestListing) return;
                        document.getElementById(sellerListingWorkspaceAnchor(newestListing))?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    {isAr ? "إدارة العروض" : "Manage Listings"}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isWorkspaceWidgetsLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <div key={`my-listings-skeleton-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-white/10" />
                  </div>
                ))
              ) : null}
              {!isWorkspaceWidgetsLoading && myListings.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center shadow-[0_8px_24px_rgba(2,6,23,0.35)]">
                  <Store className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "ليس لديك عروض نشطة حتى الآن" : "You don’t have any active listings yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "أنشئ أول عرضك الآن ليبدأ المشترون بطلب الشراء." : "Create your first listing now and start receiving buyer requests."}</p>
                  <Button type="button" size="sm" className="mt-3 h-9" onClick={() => { void scrollToCreateListingSection(); }}>
                    {isAr ? "إنشاء عرض" : "Create Listing"}
                  </Button>
                </div>
              ) : null}
              {(sellerListingsExpanded
                ? sortedDashboardListings
                : sortedDashboardListings.slice(0, isMobileViewport ? 1 : 2)
              ).map((listing) => {
                const requestsCount = sellerRequests.filter((request) => request.listingId === listing.id).length;
                const listingBusy = isListingActionBusy(listing.id);
                const isDashboardListingExpanded = sellerExpandedListingId === listing.id;
                const isAwaitingApproval = listing.status === "draft" && listing.approvalStatus === "pending";
                const isLockedForActiveTrade = Boolean(listing.activeTradeRequestId)
                  || listing.status === "matched"
                  || listing.status === "in_trade";
                const listingPaymentMethods = normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod)
                  .map((method) => paymentMethodLabel(method, isAr))
                  .join(isAr ? "، " : ", ") || (isAr ? "غير محدد" : "Not set");
                const listingAttention = isAwaitingApproval
                  ? (isAr ? "بانتظار موافقة الإدارة" : "Awaiting admin approval")
                  : isLockedForActiveTrade
                    ? (isAr ? "مقفل بسبب صفقة نشطة" : "Active trade lock")
                    : listing.status === "paused"
                      ? (isAr ? "متوقف مؤقتاً" : "Paused")
                      : listing.status === "active"
                        ? (isAr ? "مباشر" : "Live")
                        : listingStatusLabel(listing.status, isAr);
                const listingRequiredAction = isAwaitingApproval
                  ? (isAr ? "انتظر موافقة Alpha Traders" : "Wait for Alpha Traders approval")
                  : isLockedForActiveTrade
                    ? (isAr ? "أكمل الصفقة النشطة" : "Complete the active trade")
                    : listing.status === "paused"
                      ? (isAr ? "استأنف عندما تكون جاهزاً" : "Resume when ready")
                      : listing.status === "active"
                        ? (isAr ? "راقب طلبات الشراء" : "Monitor purchase requests")
                        : (isAr ? "راجع حالة العرض" : "Review listing status");
                return (
                  <div
                    id={sellerListingWorkspaceAnchor(listing)}
                    key={listing.id}
                    tabIndex={-1}
                    data-seller-compact-listing="true"
                    data-listing-id={listing.id}
                    className="scroll-mt-24 overflow-hidden rounded-2xl border border-white/10 bg-black/20 transition-all duration-200 hover:border-[#C9A227]/30"
                  >
                    <button
                      type="button"
                      className="grid w-full gap-2 px-3 py-3 text-start transition hover:bg-white/[0.03] sm:grid-cols-[1.15fr_0.8fr_0.7fr_1fr_1fr_auto] sm:items-center"
                      aria-expanded={isDashboardListingExpanded}
                      aria-controls={`seller-listing-details-${listing.id}`}
                      onClick={() => setSellerExpandedListingId((current) => current === listing.id ? null : listing.id)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{isAr ? "العرض" : "Listing"} {shortListingRef(listing)}</p>
                        <p className="mt-0.5 text-xs text-[#9CA3AF]">{listingAttention}</p>
                      </div>
                      <p className="text-xs text-[#D1D5DB]"><span className="text-[#9CA3AF]">{isAr ? "الكمية " : "Amount "}</span>{toNumber(listing.availableAmount).toLocaleString("en-IL")} USDT</p>
                      <p className="text-xs text-[#D1D5DB]"><span className="text-[#9CA3AF]">{isAr ? "السعر " : "Price "}</span>{formatIls(toNumber(listing.price))}</p>
                      <p className="min-w-0 truncate text-xs text-[#D1D5DB]" title={listingPaymentMethods}><span className="text-[#9CA3AF]">{isAr ? "الدفع " : "Payment "}</span>{listingPaymentMethods}</p>
                      <p className={cn("text-xs font-medium", isAwaitingApproval || isLockedForActiveTrade ? "text-amber-200" : "text-[#BFDBFE]")}>{listingRequiredAction}</p>
                      <ChevronDown className={cn("h-4 w-4 text-[#9CA3AF] transition-transform", isDashboardListingExpanded && "rotate-180")} />
                    </button>
                    <div
                      id={`seller-listing-details-${listing.id}`}
                      className={cn(
                        "border-t border-white/10 px-3 pb-3 pt-3",
                        !isDashboardListingExpanded && "hidden",
                      )}
                    >
                    {listing.status === "draft" && listing.approvalStatus === "pending" ? (
                      <p className="mb-3 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100">
                        {isAr ? "بانتظار موافقة إدارة Alpha Traders — هذا العرض غير ظاهر للمشترين بعد." : "Awaiting Alpha Traders admin approval — this listing is not visible to buyers yet."}
                      </p>
                    ) : null}
                    <div className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{listingStatusLabel(listing.status, isAr)}</span></p>
                      <p>{isAr ? "الإجراء المطلوب" : "Required action"}: <span className="text-white">{listingRequiredAction}</span></p>
                      <p>{isAr ? "طلبات الشراء" : "Purchase requests"}: <span className="text-white">{requestsCount}</span></p>
                      <p>{isAr ? "آخر نشاط" : "Last activity"}: <span className="text-white">{new Date(listing.updatedAt || listing.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                      <DiscordShareAction
                        listing={listing}
                        sharing={discordSharing}
                        busy={discordShareActionKey === listing.id}
                        locale={locale}
                        onShare={(selected) => {
                          void handleDiscordListingShare(selected);
                        }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-9"
                        disabled={listingBusy}
                        onClick={() => {
                          setEditingListingId(listing.id);
                          setListingEditForm({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            currency: listing.currency,
                            network: listing.network,
                            paymentMethods: normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod),
                            bankAccountId: listing.bankAccountId ?? (sellerBankAccounts.find((account) => account.isDefault)?.id ?? sellerBankAccounts[0]?.id ?? ""),
                            bankName: listing.bankName ?? "",
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                            sellerDescription: listing.sellerDescription ?? "",
                            changeReason: "",
                            changeExplanation: "",
                          });
                          setListingEditOriginal({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                          });
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        {isAr ? "تعديل" : "Edit"}
                      </Button>
                      {listing.status === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "active")}>
                          <PlayCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:resume` ? (isAr ? "جارٍ الاستئناف..." : "Resuming...") : (isAr ? "استئناف" : "Resume")}
                        </Button>
                      ) : listing.status === "active" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "paused")}>
                          <PauseCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:pause` ? (isAr ? "جارٍ الإيقاف..." : "Pausing...") : (isAr ? "إيقاف مؤقت" : "Pause")}
                        </Button>
                      ) : null}
                      {listing.status !== "draft" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingRenew(listing)}>
                          <Clock3 className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:renew` ? (isAr ? "جارٍ التجديد..." : "Renewing...") : (isAr ? "تجديد" : "Renew")}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDelete(listing)}>
                        <Trash2 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:delete` ? (isAr ? "جارٍ الحذف..." : "Deleting...") : (isAr ? "حذف" : "Delete")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDuplicate(listing)}>
                        <Copy className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:duplicate` ? (isAr ? "جارٍ النسخ..." : "Duplicating...") : (isAr ? "نسخ العرض" : "Duplicate Listing")}
                      </Button>
                    </div>
                    {editingListingId === listing.id ? (
                      <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={handleSellerListingEditSubmit}>
                        <Input value={listingEditForm.availableAmount} onChange={(event) => setListingEditForm((prev) => ({ ...prev, availableAmount: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الكمية المتاحة" : "Available Amount"} />
                        <div className="space-y-2">
                          <Input
                            value={listingEditForm.price}
                            onChange={(event) => setListingEditForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                            placeholder={isAr ? "السعر" : "Price"}
                            className={`transition-all duration-200 ${
                              listingEditPriceInvalid
                                ? "border-red-500/85 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"
                                : listingEditPriceValid
                                  ? "border-emerald-500/80 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]"
                                  : ""
                            }`}
                          />
                          <p className={`text-xs transition-colors duration-200 ${
                            listingEditPriceInvalid ? "text-red-300" : listingEditPriceValid ? "text-emerald-300" : "text-[#9CA3AF]"
                          }`}>
                            {listingEditPriceInvalid
                              ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)}).` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`)
                              : listingEditPriceValid
                                ? (isAr ? `السعر صالح. الحد الأقصى المسموح هو ${formatIls(maxAllowedListingPrice)}.` : `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`)
                                : (isAr ? `أدخل سعراً لا يتجاوز ${formatIls(maxAllowedListingPrice)}.` : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`)}
                          </p>
                        </div>
                        <Input value={listingEditForm.currency} onChange={(event) => setListingEditForm((prev) => ({ ...prev, currency: event.target.value }))} placeholder={isAr ? "العملة" : "Currency"} />
                        <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingEditForm.network} onChange={(event) => setListingEditForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                          <option value="TRC20">TRC20</option>
                          <option value="ERC20">ERC20</option>
                          <option value="BEP20">BEP20</option>
                          <option value="SOL">SOL</option>
                        </select>
                        <Input value={listingEditForm.minimumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الحد الأدنى للصفقة" : "Minimum Trade"} />
                        <Input value={listingEditForm.maximumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, maximumTrade: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الحد الأقصى للصفقة" : "Maximum Trade"} />
                        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "طريقة الدفع" : "Payment Method"} *</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            {MARKETPLACE_PAYMENT_METHODS.map((method) => {
                              const selected = listingEditSelectedMethods.includes(method);
                              return (
                                <button
                                  key={`${listing.id}-method-${method}`}
                                  type="button"
                                  onClick={() => setListingEditForm((prev) => {
                                    const nextMethods = toggleSelection(prev.paymentMethods, method, MAX_LISTING_PAYMENT_METHODS);
                                    return {
                                      ...prev,
                                      paymentMethods: nextMethods,
                                      bankName: requiresBankSelection(nextMethods) ? prev.bankName : "",
                                    };
                                  })}
                                  className={`rounded-xl border p-2.5 text-start transition-all duration-200 ${
                                    selected
                                      ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <p className="text-xs font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? `اختر حتى ${MAX_LISTING_PAYMENT_METHODS} طرق.` : `Select up to ${MAX_LISTING_PAYMENT_METHODS} methods.`}</p>
                        </div>
                        <Textarea className="md:col-span-2" value={listingEditForm.sellerDescription} onChange={(event) => setListingEditForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} aria-label={isAr ? "وصف البائع" : "Seller description"} placeholder={isAr ? "وصف البائع" : "Seller Description"} />
                        {listingEditRequiresBank ? (
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "البنوك المدعومة" : "Supported banks"} *</p>
                          <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? `اختر حتى ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} بنوك للتحويل البنكي أو السحب بلا بطاقة.` : `Select up to ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.`}</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            {ISRAELI_BANKS.map((bank) => {
                              const selected = listingEditSelectedBanks.includes(bank.name);
                              return (
                                <button
                                  key={`${listing.id}-${bank.id}`}
                                  type="button"
                                  onClick={() => setListingEditForm((prev) => {
                                    const nextBanks = toggleSelection(parseIsraeliBankSelection(prev.bankName), bank.name, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS);
                                    return { ...prev, bankName: serializeIsraeliBankSelection(nextBanks) };
                                  })}
                                  className={`rounded-xl border p-2 text-start transition-all duration-200 ${
                                    selected
                                      ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/35">
                                      {renderBankLogo(bank)}
                                    </span>
                                    <div>
                                      <p className="text-xs font-medium text-white">{getIsraeliBankDisplayName(bank.name, locale)}</p>
                                      <p className="text-[10px] text-[#9CA3AF]">{bank.code}</p>
                                    </div>
                                  </div>
                                  {selected ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "محدد" : "Selected"}</p> : null}
                                </button>
                              );
                            })}
                          </div>
                          {listingEditSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">{isAr ? "المحدد" : "Selected"}: {listingEditSelectedBanks.map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</p> : null}
                        </div>
                        ) : null}
                        {listingEditRequiresBankAccount ? (
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الحساب البنكي لاستلام الدفعات" : "Payout bank account"} *</p>
                          {sellerBankAccountsLoading ? (
                            <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? "جارٍ تحميل حساباتك البنكية المحفوظة..." : "Loading your saved bank accounts..."}</p>
                          ) : sellerBankAccounts.length === 0 ? (
                            <p className="mt-2 text-xs text-amber-300">
                              {isAr ? <>لم يتم العثور على حسابات بنكية محفوظة. أضف حساباً في <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">الإعدادات</a> قبل حفظ العرض.</> : <>No saved bank accounts found. Add one in <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">Settings</a> before saving this listing.</>}
                            </p>
                          ) : (
                            <>
                              <select
                                className="mt-2 flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white"
                                value={listingEditForm.bankAccountId}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, bankAccountId: event.target.value }))}
                              >
                                <option value="">{isAr ? "اختر حساباً بنكياً" : "Select bank account"}</option>
                                {sellerBankAccounts.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {`${getIsraeliBankDisplayName(account.bankName, locale)} • ${account.maskedAccountNumber ?? `****${account.accountLast4}`}${account.isDefault ? (isAr ? " (افتراضي)" : " (Default)") : ""}`}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "لن يرى المشترون رقم حسابك الكامل أبداً." : "Buyers never see your full account number."}</p>
                            </>
                          )}
                        </div>
                        ) : null}
                        {listingEditNeedsReason ? (
                          <div className="md:col-span-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FDE68A]">{isAr ? "سبب التغيير" : "Reason for change"} <span className="text-red-300">*</span></p>
                            <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? "يتم تسجيل تعديل الكمية أو السعر أو التوفر لضمان الشفافية في السوق." : "Editing amount, price, or availability is recorded for marketplace accountability."}</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <select
                                aria-label={isAr ? "سبب تغيير العرض" : "Reason for listing change"}
                                className={cn(
                                  "flex h-11 w-full rounded-xl border bg-[#101010] px-3 py-2 text-sm text-white",
                                  listingEditForm.changeReason ? "border-emerald-500/60" : "border-red-500/70",
                                )}
                                value={listingEditForm.changeReason}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeReason: event.target.value }))}
                              >
                                <option value="">{isAr ? "اختر سبباً…" : "Select a reason…"}</option>
                                {LISTING_CHANGE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>{listingChangeReasonLabel(reason, isAr)}</option>
                                ))}
                              </select>
                              <Input
                                aria-label={isAr ? "شرح التغيير" : "Change explanation"}
                                placeholder={isAr ? "اشرح هذا التغيير باختصار" : "Briefly explain this change"}
                                value={listingEditForm.changeExplanation}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeExplanation: event.target.value }))}
                                className={listingEditForm.changeExplanation.trim().length >= 5 ? "border-emerald-500/60" : "border-red-500/70"}
                              />
                            </div>
                            {!listingEditReasonValid ? (
                              <p className="mt-2 text-xs text-red-300">{isAr ? "اختر سبباً وأضف شرحاً قصيراً (5 أحرف على الأقل)." : "Choose a reason and add a short explanation (at least 5 characters)."}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={`md:col-span-4 rounded-2xl border p-3 text-xs transition-all duration-200 ${listingEditGuardTone}`}>
                          <div className="flex items-start gap-2">
                            {listingEditPriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                            <div className="space-y-1">
                              <p className="font-medium">
                                {listingEditPriceInvalid ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)})` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})`) : (isAr ? "حماية سعر السوق مفعلة" : "Market guard active")}
                              </p>
                              <p>{isAr ? "سعر السوق الحالي" : "Current market"}: {formatIls(marketPricePerUsdt)} {isAr ? "لكل 1 USDT" : "per 1 USDT"}</p>
                              <p>{isAr ? "الحد الأقصى المسموح" : "Maximum allowed"}: {formatIls(maxAllowedListingPrice)}</p>
                              {listingEditTradeRangeInvalid ? <p className="text-amber-200">{isAr ? "يجب أن يكون الحد الأقصى للصفقة أكبر من الحد الأدنى وألا يتجاوز كمية USDT المتاحة." : "Maximum trade must be greater than minimum trade and less than or equal to available USDT."}</p> : null}
                              {listingEditRequiresBank && !listingEditSelectedBanks.length ? <p className="text-amber-200">{isAr ? "اختر بنكاً واحداً أو بنكين مدعومين قبل الحفظ." : "Select one or two supported banks before saving."}</p> : null}
                              {listingEditRequiresBankAccount && !listingEditForm.bankAccountId ? <p className="text-amber-200">{isAr ? "اختر حساباً بنكياً واحداً لاستلام الدفعات قبل الحفظ." : "Select one payout bank account before saving."}</p> : null}
                              {listingEditAmount > 0 ? <p>{listingEditAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingEditAmount * marketPricePerUsdt)}</p> : null}
                            </div>
                          </div>
                        </div>
                        <div className="md:col-span-4 flex gap-2">
                          <Button type="submit" size="sm" disabled={isListingEditSubmitDisabled || !listingEditReasonValid || listingActionKey === `${listing.id}:save`}>
                            {listingActionKey === `${listing.id}:save` ? (isAr ? "جارٍ الحفظ..." : "Saving...") : (isAr ? "حفظ" : "Save")}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingListingId(null); setListingEditOriginal(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
                        </div>
                      </form>
                    ) : null}
                    </div>
                  </div>
                );
              })}
              {sortedDashboardListings.length > (isMobileViewport ? 1 : 2) ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSellerListingsExpanded((current) => !current)}
                  >
                    {sellerListingsExpanded
                      ? (isAr ? "عرض عدد أقل من العروض" : "Show fewer listings")
                      : (isAr ? `عرض جميع العروض (${sortedDashboardListings.length - (isMobileViewport ? 1 : 2)})` : `View All Listings (${sortedDashboardListings.length - (isMobileViewport ? 1 : 2)})`)}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          );
          return sellerDashboardListingsTarget ? createPortal(sellerListingsWorkspace, sellerDashboardListingsTarget) : null;
        })();
}
