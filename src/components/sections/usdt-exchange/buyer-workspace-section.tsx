"use client";

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { HandCoins } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/role-badge";
import { Textarea } from "@/components/ui/textarea";
import { localizeActivityCopy } from "@/lib/notification-localization";
import { normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import type { ClientSessionUser } from "@/lib/client-session-user";
import type { AlphaExchangeActivityLogEntry, MarketplaceListing, PurchaseRequest, PurchaseRequestStatus } from "@/types/alpha-exchange";

type NotificationPreferences = { inApp: boolean; email: boolean; sms: boolean };

export type BuyerWorkspaceSectionProps = {
  activityHistory: AlphaExchangeActivityLogEntry[];
  archivedConfirmationTrade: PurchaseRequest | undefined;
  buyerEvidenceFiles: Record<string, File | null>;
  buyerExpandedTradeId: string | null;
  buyerOverviewCard: ReactNode;
  buyerRequests: PurchaseRequest[];
  buyerTradeQuery: string;
  buyerTradeStatus: PurchaseRequestStatus | "all";
  buyerTradeVisibleCount: number;
  evidenceUploading: Record<string, boolean>;
  filteredBuyerRequests: PurchaseRequest[];
  groupedActivityHistory: Array<{ dayKey: string; label: string; items: AlphaExchangeActivityLogEntry[] }>;
  handleBuyerTradeStatus: (request: PurchaseRequest, nextStatus: "payment_sent" | "completed" | "cancelled") => Promise<void>;
  handleNotificationPreferencesSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleOpenTradeRoom: (requestId: string) => void;
  handlePrefetchTradeRoom: (requestId: string) => void;
  handleSubmitBuyerReview: (request: PurchaseRequest) => Promise<void>;
  isAr: boolean;
  isMobileViewport: boolean;
  listingsById: Map<string, MarketplaceListing>;
  locale: "ar" | "en";
  notificationPreferences: NotificationPreferences;
  pendingBuyerReviewTrade: PurchaseRequest | undefined;
  renderNotificationCenterCard: (sectionId: string, className?: string) => ReactNode;
  sessionUser: ClientSessionUser | null;
  setBuyerEvidenceFiles: Dispatch<SetStateAction<Record<string, File | null>>>;
  setBuyerExpandedTradeId: Dispatch<SetStateAction<string | null>>;
  setBuyerTradeQuery: Dispatch<SetStateAction<string>>;
  setBuyerTradeStatus: Dispatch<SetStateAction<PurchaseRequestStatus | "all">>;
  setBuyerTradeVisibleCount: Dispatch<SetStateAction<number>>;
  setNotificationPreferences: Dispatch<SetStateAction<NotificationPreferences>>;
  setSessionUser: Dispatch<SetStateAction<ClientSessionUser | null>>;
  setTradeReviewDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  sortedBuyerRequests: PurchaseRequest[];
  tradeReviewDrafts: Record<string, string>;
  uploadTradeEvidenceFile: (requestId: string, side: "buyer" | "seller", file: File) => Promise<boolean>;
  BUYER_TRADE_HISTORY_SECTION_ID: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").BUYER_TRADE_HISTORY_SECTION_ID;
  CompactTradeTimeline: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").CompactTradeTimeline;
  LocalizedEvidenceFileInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").LocalizedEvidenceFileInput;
  canCancelBuyerHistoryRequest: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").canCancelBuyerHistoryRequest;
  getTradeQueuePresentation: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").getTradeQueuePresentation;
  paymentMethodEmoji: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodEmoji;
  paymentMethodLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodLabel;
  paymentMethodTradeInstruction: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodTradeInstruction;
  roleBadgeVariantFromSession: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").roleBadgeVariantFromSession;
  shortListingRef: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").shortListingRef;
  shortTradeRef: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").shortTradeRef;
  toNumber: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").toNumber;
  tradeStatusLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").tradeStatusLabel;
};

export function BuyerWorkspaceSection(props: BuyerWorkspaceSectionProps) {
  const {
    activityHistory,
    archivedConfirmationTrade,
    buyerEvidenceFiles,
    buyerExpandedTradeId,
    buyerOverviewCard,
    buyerRequests,
    buyerTradeQuery,
    buyerTradeStatus,
    buyerTradeVisibleCount,
    evidenceUploading,
    filteredBuyerRequests,
    groupedActivityHistory,
    handleBuyerTradeStatus,
    handleNotificationPreferencesSave,
    handleOpenTradeRoom,
    handlePrefetchTradeRoom,
    handleSubmitBuyerReview,
    isAr,
    isMobileViewport,
    listingsById,
    locale,
    notificationPreferences,
    pendingBuyerReviewTrade,
    renderNotificationCenterCard,
    sessionUser,
    setBuyerEvidenceFiles,
    setBuyerExpandedTradeId,
    setBuyerTradeQuery,
    setBuyerTradeStatus,
    setBuyerTradeVisibleCount,
    setNotificationPreferences,
    setSessionUser,
    setTradeReviewDrafts,
    sortedBuyerRequests,
    tradeReviewDrafts,
    uploadTradeEvidenceFile,
    BUYER_TRADE_HISTORY_SECTION_ID,
    CompactTradeTimeline,
    LocalizedEvidenceFileInput,
    canCancelBuyerHistoryRequest,
    getTradeQueuePresentation,
    paymentMethodEmoji,
    paymentMethodLabel,
    paymentMethodTradeInstruction,
    roleBadgeVariantFromSession,
    shortListingRef,
    shortTradeRef,
    toNumber,
    tradeStatusLabel,
  } = props;

  return (
<div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] xl:items-start">
          {pendingBuyerReviewTrade ? (
            <Card className="md:col-span-2 border-[#C9A227]/40 bg-[#C9A227]/10">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">?</span>
                  <div>
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "أكمل صفقتك السابقة أولاً" : "Complete your previous trade first"}</p>
                    <p className="mt-0.5 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "قبل بدء صفقة جديدة، قيّم البائع في صفقتك السابقة."
                        : "Before starting another trade, please rate your previous seller."}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" className="w-full sm:w-auto">
                      {isAr ? "إضافة تقييم" : "Leave Feedback"}
                    </Button>
                  </Link>
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                      {isAr ? "عرض الصفقة السابقة" : "View Previous Trade"}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : archivedConfirmationTrade ? (
            <Card className="md:col-span-2 border-[#C9A227]/40 bg-[#C9A227]/10">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⏰</span>
                  <div>
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "إجراء مطلوب — تأكيد استلام USDT" : "Action Required — Confirm USDT Receipt"}</p>
                    <p className="mt-0.5 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "لديك صفقة تنتظر تأكيد استلام USDT. يرجى التأكيد لإكمال صفقتك والسماح بعمليات الشراء الجديدة."
                        : "You have a trade waiting for your USDT receipt confirmation. Please confirm receipt to complete your trade and unblock new purchases."}
                    </p>
                  </div>
                </div>
                <Link href={`/trade-room/${archivedConfirmationTrade.id}`} className="shrink-0">
                  <Button size="sm" className="w-full sm:w-auto">
                    {isAr ? "تأكيد الاستلام" : "Confirm Receipt"}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {buyerOverviewCard}
          <Card className="border-white/10 bg-[#0B0B0B]/85">
            <CardHeader>
              <CardTitle>{isAr ? "جلسة المستخدم" : "Session"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-[#D1D5DB]">
                {sessionUser ? sessionUser.fullName : (isAr ? "غير مسجل الدخول" : "Not logged in")}
              </p>
              {sessionUser ? <RoleBadge variant={roleBadgeVariantFromSession(sessionUser)} locale={isAr ? "ar" : "en"} /> : <RoleBadge variant="guest" locale={isAr ? "ar" : "en"} />}
              <div className="flex flex-wrap gap-2">
                {!sessionUser ? (
                  <>
                    <Link href="/login">
                      <Button variant="secondary">{isAr ? "تسجيل الدخول" : "Login"}</Button>
                    </Link>
                    <Link href="/register">
                      <Button variant="secondary">{isAr ? "إنشاء حساب" : "Register"}</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/profile">
                      <Button variant="secondary">{isAr ? "الملف الشخصي" : "Profile"}</Button>
                    </Link>
                    <LogoutButton
                      locale={locale}
                      variant="secondary"
                      idleLabel={isAr ? "تسجيل الخروج" : "Logout"}
                      pendingLabel={isAr ? "جارٍ تسجيل الخروج..." : "Signing out..."}
                      onSignedOut={() => setSessionUser(null)}
                    />
                  </>
                )}
              </div>
              {sessionUser ? (
                <form className="grid gap-2 border-t border-white/10 pt-3" onSubmit={handleNotificationPreferencesSave}>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "تفضيلات الإشعارات" : "Notification Preferences"}</p>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "داخل التطبيق" : "In-app"}</span>
                    <input type="checkbox" checked={notificationPreferences.inApp} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, inApp: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "البريد الإلكتروني (قريباً)" : "Email (future-ready)"}</span>
                    <input type="checkbox" checked={notificationPreferences.email} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, email: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "رسائل SMS (قريباً)" : "SMS (future-ready)"}</span>
                    <input type="checkbox" checked={notificationPreferences.sms} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, sms: event.target.checked }))} />
                  </label>
                  <Button type="submit" size="sm" variant="secondary">{isAr ? "حفظ التفضيلات" : "Save Preferences"}</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {sessionUser ? (
            <Card id={BUYER_TRADE_HISTORY_SECTION_ID} tabIndex={-1} className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>{isAr ? "سجل صفقاتي" : "My Trade History"}</CardTitle>
                <CardDescription>{isAr ? "الأحدث أولاً، مع صفوف مختصرة وتفاصيل قابلة للتوسيع لكل صفقة." : "Newest first, compact rows, and expandable details for each trade."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder={isAr ? "ابحث بمعرّف الصفقة أو العرض..." : "Search by trade ID or listing..."} value={buyerTradeQuery} onChange={(event) => setBuyerTradeQuery(event.target.value)} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={buyerTradeStatus} onChange={(event) => setBuyerTradeStatus(event.target.value as typeof buyerTradeStatus)}>
                    <option value="all">{isAr ? "الحالة: الكل" : "Status: All"}</option>
                    <option value="pending">{tradeStatusLabel("pending", isAr)}</option>
                    <option value="accepted">{tradeStatusLabel("accepted", isAr)}</option>
                    <option value="payment_sent">{tradeStatusLabel("payment_sent", isAr)}</option>
                    <option value="funds_received">{tradeStatusLabel("funds_received", isAr)}</option>
                    <option value="usdt_release_pending">{tradeStatusLabel("usdt_release_pending", isAr)}</option>
                    <option value="usdt_sent">{tradeStatusLabel("usdt_sent", isAr)}</option>
                    <option value="review_open">{tradeStatusLabel("review_open", isAr)}</option>
                    <option value="declined">{tradeStatusLabel("declined", isAr)}</option>
                    <option value="cancelled">{tradeStatusLabel("cancelled", isAr)}</option>
                  </select>
                </div>
                {!filteredBuyerRequests.length ? (
                  buyerRequests.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                      <HandCoins className="mx-auto h-5 w-5 text-[#C9A227]" />
                      <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد صفقات بعد" : "No trades yet"}</p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "تصفح البائعين الموثقين وابدأ صفقتك الأولى." : "Browse verified sellers and start your first trade."}</p>
                      <Link href="/usdt-exchange#marketplace" locale={locale} className="mt-3 inline-flex items-center gap-1 text-xs text-[#93C5FD] hover:underline">
                        {isAr ? "تصفح السوق ←" : "Browse Marketplace →"}
                      </Link>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">{isAr ? "لا توجد صفقات مطابقة للفلاتر الحالية." : "No trades found for current filters."}</div>
                  )
                ) : null}
                {sortedBuyerRequests.length ? (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="hidden grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] gap-3 border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF] md:grid">
                      <span>{isAr ? "الصفقة" : "Trade"}</span>
                      <span>{isAr ? "الحالة" : "Status"}</span>
                      <span>{isAr ? "الكمية" : "Amount"}</span>
                      <span>{isAr ? "الطريقة" : "Method"}</span>
                      <span>{isAr ? "آخر تحديث" : "Updated"}</span>
                      <span className="text-end">{isAr ? "التفاصيل" : "Details"}</span>
                    </div>
                    {sortedBuyerRequests.slice(0, buyerTradeVisibleCount).map((request) => {
                      const presentation = getTradeQueuePresentation(request, "buyer", isAr);
                      const isExpanded = buyerExpandedTradeId === request.id;
                      return (
                        <div key={request.id} className="border-t border-white/10 first:border-t-0">
                          <button
                            type="button"
                            className="grid w-full gap-3 px-4 py-3 text-start transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] md:items-center"
                            aria-expanded={isExpanded}
                            aria-controls={`buyer-trade-details-${request.id}`}
                            onClick={() => setBuyerExpandedTradeId((prev) => prev === request.id ? null : request.id)}
                          >
                            <div>
                              <p className="text-sm font-medium text-white">{shortTradeRef(request, isAr)}</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "العرض" : "Listing"} {shortListingRef({ id: request.listingId, displayNumber: listingsById.get(request.listingId)?.displayNumber })}</p>
                              {request.priceMode === "buyer_offer" ? <span className="mt-1.5 inline-flex rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] font-semibold text-[#F4D87A]">{isAr ? "عرض سعر" : "Price Offer"}</span> : null}
                            </div>
                            <div className="text-xs">
                              <span className={`rounded-full border px-2.5 py-1 font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                            </div>
                            <div className="text-sm text-[#D1D5DB]">
                              <p>{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</p>
                            </div>
                            <p className="text-sm text-[#D1D5DB]">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod, isAr)}</p>
                            <p className="text-sm text-[#D1D5DB]">{new Date(request.completedAt ?? request.updatedAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</p>
                            <p className="text-sm text-[#C9A227] md:text-end">{isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "توسيع" : "Expand")}</p>
                          </button>
                          {isExpanded ? (
                            <div id={`buyer-trade-details-${request.id}`} className="space-y-3 border-t border-white/10 bg-black/25 px-4 py-4">
                              <div className="grid gap-2 text-sm md:grid-cols-3">
                                <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{request.network}</span></p>
                                <p>{request.priceMode === "buyer_offer" ? (isAr ? "سعرك المقترح" : "Your Offered Price") : (isAr ? "السعر لكل USDT" : "Price per USDT")}: <span className={request.priceMode === "buyer_offer" ? "font-semibold text-[#F4D87A]" : "text-white"}>₪{(toNumber(request.pricePerUsdt) || (toNumber(request.fiatAmount) / Math.max(1, toNumber(request.usdtAmount)))).toFixed(2)}</span></p>
                                {request.priceMode === "buyer_offer" ? <p>{isAr ? "سعر البائع الأصلي" : "Original Seller Price"}: <span className="text-white">₪{toNumber(request.listingPriceAtRequest).toFixed(2)}</span></p> : null}
                                <p>{isAr ? "تاريخ الإرسال" : "Submitted"}: <span className="text-white">{new Date(request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                                {request.completedAt ? <p>{isAr ? "اكتملت" : "Completed"}: <span className="text-white">{new Date(request.completedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                              </div>
                              <div className="rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} {isAr ? "تعليمات الصفقة" : "Trade Instructions"}</p>
                                <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "buyer", isAr)}</p>
                                <p className="mt-1">{isAr ? <>راجع التفاصيل في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Review details in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="secondary" onMouseEnter={() => handlePrefetchTradeRoom(request.id)} onFocus={() => handlePrefetchTradeRoom(request.id)} onClick={() => handleOpenTradeRoom(request.id)}>
                                  {isAr ? "فتح غرفة التداول" : "Open Trade Room"}
                                </Button>
                                <Button type="button" size="sm" disabled={request.status !== "accepted" || !request.buyerEvidence} onClick={() => handleBuyerTradeStatus(request, "payment_sent")}>
                                  {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? (isAr ? "تحديد السحب كجاهز" : "Mark Withdrawal Ready") : (isAr ? "تحديد الدفعة كمُرسلة" : "Mark Payment Sent")}
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_sent"} onClick={() => handleBuyerTradeStatus(request, "completed")}>
                                  {isAr ? "تأكيد اكتمال الصفقة" : "Confirm Trade Completed"}
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={!canCancelBuyerHistoryRequest(request, sessionUser?.id)} onClick={() => handleBuyerTradeStatus(request, "cancelled")}>
                                  {isAr ? "إلغاء" : "Cancel"}
                                </Button>
                              </div>
                              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-white">{isAr ? "إثبات المشتري" : "Buyer Evidence"}</p>
                                  {request.buyerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.buyerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">{isAr ? "يجب رفع الإثبات قبل تحديد الدفعة كمُرسلة." : "Upload required before marking payment sent."}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Evidence"}</p>
                                  {request.sellerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.sellerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">{isAr ? "بانتظار إثبات البائع." : "Waiting for seller evidence."}</p>
                                  )}
                                </div>
                                {!request.buyerEvidence ? (
                                  <div className="md:col-span-2">
                                    <p className="text-sm font-semibold text-white">{isAr ? "رفع إثبات الدفع" : "Upload payment evidence"}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <LocalizedEvidenceFileInput
                                        id={`buyer-evidence-file-${request.id}`}
                                        isAr={isAr}
                                        selectedFile={buyerEvidenceFiles[request.id] ?? null}
                                        onSelect={(file) => {
                                          setBuyerEvidenceFiles((prev) => ({ ...prev, [request.id]: file }));
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={!buyerEvidenceFiles[request.id] || evidenceUploading[`${request.id}:buyer`]}
                                        onClick={() => {
                                          const file = buyerEvidenceFiles[request.id];
                                          if (!file) return;
                                          void uploadTradeEvidenceFile(request.id, "buyer", file);
                                        }}
                                      >
                                        {evidenceUploading[`${request.id}:buyer`] ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <CompactTradeTimeline events={request.timeline ?? []} isAr={isAr} />
                              {request.status === "review_open" && !request.buyerReview ? (
                                <form
                                  className="grid gap-2"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void handleSubmitBuyerReview(request);
                                  }}
                                >
                                  <Textarea aria-label={isAr ? "إضافة تقييم للصفقة" : "Leave trade review"} placeholder={isAr ? "أضف تقييماً واحداً بعد اكتمال الصفقة" : "Leave one review after completed trade"} value={tradeReviewDrafts[request.id] ?? ""} onChange={(event) => setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                                  <div>
                                    <Button type="submit" size="sm" variant="secondary">{isAr ? "إرسال تقييم المشتري" : "Submit Buyer Review"}</Button>
                                  </div>
                                </form>
                              ) : null}
                              {request.buyerReview ? (
                                <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">{isAr ? "تقييم المشتري" : "Buyer Review"}</p>
                                  <p className="mt-1">{request.buyerReview.comment}</p>
                                </div>
                              ) : null}
                              {request.sellerResponse ? (
                                <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">{isAr ? "رد البائع" : "Seller Response"}</p>
                                  <p className="mt-1">{request.sellerResponse.message}</p>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {sortedBuyerRequests.length > buyerTradeVisibleCount ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setBuyerTradeVisibleCount((value) => (
                        value >= sortedBuyerRequests.length ? (isMobileViewport ? 1 : 2) : sortedBuyerRequests.length
                      ))}
                    >
                      {isAr ? "عرض المزيد" : "View more"}
                    </Button>
                  </div>
                ) : buyerTradeVisibleCount > (isMobileViewport ? 1 : 2) ? (
                  <div className="flex justify-center">
                    <Button type="button" variant="secondary" onClick={() => setBuyerTradeVisibleCount(isMobileViewport ? 1 : 2)}>
                      {isAr ? "عرض أقل" : "Show less"}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {sessionUser ? renderNotificationCenterCard("notification-center-section", "md:col-span-2") : null}
          {sessionUser ? (
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>{isAr ? "الخط الزمني للنشاط" : "Activity Timeline"}</CardTitle>
                <CardDescription>{isAr ? "الأحدث أولاً، مجمّع حسب التاريخ، في بطاقات نشاط مختصرة." : "Newest first, grouped by date, with compact activity cards."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!activityHistory.length ? (
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "يتم تحديث الخط الزمني تلقائياً عند التداول والتقييم وإدارة العروض." : "Your timeline updates automatically as you trade, review, and manage listings."}</p>
                ) : (
                  groupedActivityHistory.map((group) => (
                    <div key={group.dayKey} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                        {group.items.slice(0, 3).map((entry) => {
                          const copy = localizeActivityCopy(entry, locale);
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                              <div className="flex items-start justify-between gap-3">
                                <p className="font-medium text-white"><bdi dir="auto">{copy.title}</bdi></p>
                                <p className="shrink-0 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</p>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[#9CA3AF]"><bdi dir="auto">{copy.details}</bdi></p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
  );
}
