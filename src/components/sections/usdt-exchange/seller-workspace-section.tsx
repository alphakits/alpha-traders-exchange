"use client";

import type { Dispatch, FormEvent, ReactNode, RefObject, SetStateAction } from "react";
import { AlertTriangle, Building2, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Copy, Loader2, LockKeyhole, MessageCircle, ShieldCheck, Star, TrendingUp, Trophy, Users, Wallet, WalletCards, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel, requiredFieldClasses } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/role-badge";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_COMMISSION_WALLETS, COMMISSION_NETWORKS, type CommissionNetworkId, type CommissionWalletConfiguration } from "@/lib/commission-config";
import type { CommissionWorkspaceAction } from "@/lib/dashboard-workspace";
import { getIsraeliBankDisplayName, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { MARKETPLACE_PAYMENT_METHODS, MAX_LISTING_PAYMENT_METHODS, normalizeMarketplacePaymentMethod, type MarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { ensurePayoutBankIsSupported } from "@/lib/seller-listing-bank-selection";
import { containsArabicText, localizeActivityCopy } from "@/lib/notification-localization";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { cn } from "@/lib/utils";
import type { MarketSnapshot } from "@/types/market";
import type { AlphaExchangeActivityLogEntry, MarketplaceListing, PurchaseRequest, PurchaseRequestStatus, SellerApplication, SellerReputationSnapshot, SupportedNetwork } from "@/types/alpha-exchange";
import type { ClientSessionUser } from "@/lib/client-session-user";
import type { ListingCreateResult, SellerBankAccount, SellerCommissionStatus, TradeQueueSectionKey } from "@/components/sections/usdt-exchange/usdt-exchange-page";

type ListingCreateForm = {
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
};

type SellerOverviewStats = {
  activeListings: number;
  pendingRequests: number;
  completedTrades: number;
  totalUsdtSold: number;
  estimatedEarnings: number;
  averageResponseTime: string;
  tradeRequests: number;
  successRate: number;
  completionRate: number;
  estimatedCommissionPaid: number;
  revenueGenerated: number;
  repeatBuyers: number;
  averageTradeSize: number;
  reputation: SellerReputationSnapshot | null;
};

export type SellerWorkspaceSectionProps = {
  activityHistory: AlphaExchangeActivityLogEntry[];
  commissionAdvancedOpen: boolean;
  commissionCopied: boolean;
  commissionNetwork: CommissionNetworkId;
  commissionPayBusy: boolean;
  commissionPayMessage: string | null;
  commissionPayOpen: boolean;
  commissionPayableAmountDue: number;
  commissionPayerType: "personal" | "exchange" | null;
  commissionQrDataUrl: string | null;
  commissionTotalAmountDue: number;
  commissionTxSignature: string;
  commissionWalletConfiguration: CommissionWalletConfiguration | null;
  commissionWorkspaceAction: CommissionWorkspaceAction;
  deferredSellerPanelsReady: boolean;
  evidenceUploading: Record<string, boolean>;
  groupedActivityHistory: Array<{ dayKey: string; label: string; items: AlphaExchangeActivityLogEntry[] }>;
  handleCommissionPayNow: () => Promise<void>;
  handleOpenTradeRoom: (requestId: string) => void;
  handlePrefetchTradeRoom: (requestId: string) => void;
  handleSellerListingCreateSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSellerRequestAction: (requestId: string, nextStatus: "accepted" | "declined" | "funds_received" | "usdt_release_pending" | "usdt_sent", options?: { safetyAcknowledged?: boolean }) => Promise<void>;
  handleSubmitSellerResponse: (request: PurchaseRequest) => Promise<void>;
  isAr: boolean;
  isListingCreateSubmitDisabled: boolean;
  isMobileViewport: boolean;
  isWorkspaceWidgetsLoading: boolean;
  listingActionKey: string | null;
  listingBlockedByActiveLimit: boolean;
  listingBlockedByCommission: boolean;
  listingBlockedByMarketplaceEnforcement: boolean;
  listingCommissionAgreement: boolean;
  listingCreateAmount: number;
  listingCreateBankAccountMismatch: boolean;
  listingCreateCurrencyManualOverride: boolean;
  listingCreateForm: ListingCreateForm;
  listingCreateGuardCardTone: string;
  listingCreateGuardTone: string;
  listingCreatePrice: number;
  listingCreatePriceInvalid: boolean;
  listingCreatePriceValid: boolean;
  listingCreateRequiresBank: boolean;
  listingCreateRequiresBankAccount: boolean;
  listingCreateResult: ListingCreateResult | null;
  listingCreateSelectedBankAccount: SellerBankAccount | undefined;
  listingCreateSelectedBanks: string[];
  listingCreateSelectedMethods: MarketplacePaymentMethod[];
  listingCreateTotalIls: number;
  listingCreateTradeRangeInvalid: boolean;
  listingCreationBlocked: boolean;
  listingCreationBlockedReason: string;
  locale: "ar" | "en";
  marketInsightsCard: ReactNode;
  marketPricePerUsdt: number;
  marketSnapshot: MarketSnapshot | null;
  maxAllowedListingPrice: number;
  myListingsById: Map<string, MarketplaceListing>;
  openCommissionPayment: (commissionId: string) => void;
  openMarketplaceCompliancePayment: () => void;
  renderNotificationCenterCard: (sectionId: string, className?: string) => ReactNode;
  requestActionKey: string | null;
  reviewPayableCommissions: () => void;
  scrollToMyListingsSection: () => boolean;
  selectedCommissionWallet: string;
  selectedCommissionWalletAvailable: boolean;
  selectedCommissionWalletError: string;
  sellerApplication: SellerApplication | null;
  sellerBankAccounts: SellerBankAccount[];
  sellerBankAccountsLoading: boolean;
  sellerCommissionStatus: SellerCommissionStatus | null;
  sellerDeferredPanelsSentinelRef: RefObject<HTMLDivElement | null>;
  sellerEvidenceFiles: Record<string, File | null>;
  sellerExpandedTradeId: string | null;
  sellerOverviewStats: SellerOverviewStats;
  sellerPrimaryRequestsExpanded: boolean;
  sellerRequestSections: Record<TradeQueueSectionKey, PurchaseRequest[]>;
  sellerRequests: PurchaseRequest[];
  sellerResponseDrafts: Record<string, string>;
  sellerSafetyAcknowledgements: Record<string, boolean>;
  sellerTradeQuery: string;
  sellerTradeStatus: PurchaseRequestStatus | "all";
  sellerWorkspaceMessage: string | null;
  sellerWorkspaceSummary: {
    activeListingLimit: number;
    openListingCount: number;
    openTradeCount: number;
    pendingCommissionCount: number;
    canCreateListing: boolean;
    blockedReason: string | null;
    enforcement?: { restricted: boolean; blockReason: string | null };
  } | null;
  sessionUser: ClientSessionUser | null;
  setCommissionAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setCommissionCopied: Dispatch<SetStateAction<boolean>>;
  setCommissionNetwork: Dispatch<SetStateAction<CommissionNetworkId>>;
  setCommissionPayMessage: Dispatch<SetStateAction<string | null>>;
  setCommissionPayOpen: Dispatch<SetStateAction<boolean>>;
  setCommissionPayerType: Dispatch<SetStateAction<"personal" | "exchange" | null>>;
  setCommissionTxSignature: Dispatch<SetStateAction<string>>;
  setListingCommissionAgreement: Dispatch<SetStateAction<boolean>>;
  setListingCreateCurrencyManualOverride: Dispatch<SetStateAction<boolean>>;
  setListingCreateForm: Dispatch<SetStateAction<ListingCreateForm>>;
  setListingCreateResult: Dispatch<SetStateAction<ListingCreateResult | null>>;
  setSellerDashboardListingsTarget: Dispatch<SetStateAction<HTMLDivElement | null>>;
  setSellerEvidenceFiles: Dispatch<SetStateAction<Record<string, File | null>>>;
  setSellerExpandedTradeId: Dispatch<SetStateAction<string | null>>;
  setSellerPrimaryRequestsExpanded: Dispatch<SetStateAction<boolean>>;
  setSellerResponseDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setSellerSafetyAcknowledgements: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSellerTradeQuery: Dispatch<SetStateAction<string>>;
  setSellerTradeStatus: Dispatch<SetStateAction<PurchaseRequestStatus | "all">>;
  setSellerWorkspaceMessage: Dispatch<SetStateAction<string | null>>;
  sortedSellerRequests: PurchaseRequest[];
  uploadTradeEvidenceFile: (requestId: string, side: "buyer" | "seller", file: File) => Promise<boolean>;
  ISRAELI_BANKS: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").ISRAELI_BANKS;
  CompactTradeTimeline: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").CompactTradeTimeline;
  LocalizedEvidenceFileInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").LocalizedEvidenceFileInput;
  formatIls: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatIls;
  formatUsdt: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatUsdt;
  formatIntegerForInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatIntegerForInput;
  normalizeDecimalInput: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").normalizeDecimalInput;
  renderBankLogo: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").renderBankLogo;
  shortListingRef: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").shortListingRef;
  shortTradeRef: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").shortTradeRef;
  getTradeQueuePresentation: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").getTradeQueuePresentation;
  formatRelativeMinutesLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").formatRelativeMinutesLabel;
  sellerLevelLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").sellerLevelLabel;
  sellerBadgeLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").sellerBadgeLabel;
  requiresBankSelection: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").requiresBankSelection;
  toggleSelection: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").toggleSelection;
  paymentMethodLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodLabel;
  paymentMethodEmoji: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodEmoji;
  paymentMethodTradeInstruction: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").paymentMethodTradeInstruction;
  safeText: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").safeText;
  sellerAccountStatusLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").sellerAccountStatusLabel;
  spokenLanguageLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").spokenLanguageLabel;
  toNumber: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").toNumber;
  tradeStatusLabel: typeof import("@/components/sections/usdt-exchange/usdt-exchange-page").tradeStatusLabel;
};

export function SellerWorkspaceSection(props: SellerWorkspaceSectionProps) {
  const {
    activityHistory,
    commissionAdvancedOpen,
    commissionCopied,
    commissionNetwork,
    commissionPayBusy,
    commissionPayMessage,
    commissionPayOpen,
    commissionPayableAmountDue,
    commissionPayerType,
    commissionQrDataUrl,
    commissionTotalAmountDue,
    commissionTxSignature,
    commissionWalletConfiguration,
    commissionWorkspaceAction,
    deferredSellerPanelsReady,
    evidenceUploading,
    groupedActivityHistory,
    handleCommissionPayNow,
    handleOpenTradeRoom,
    handlePrefetchTradeRoom,
    handleSellerListingCreateSubmit,
    handleSellerRequestAction,
    handleSubmitSellerResponse,
    isAr,
    isListingCreateSubmitDisabled,
    isMobileViewport,
    isWorkspaceWidgetsLoading,
    listingActionKey,
    listingBlockedByActiveLimit,
    listingBlockedByCommission,
    listingBlockedByMarketplaceEnforcement,
    listingCommissionAgreement,
    listingCreateAmount,
    listingCreateBankAccountMismatch,
    listingCreateCurrencyManualOverride,
    listingCreateForm,
    listingCreateGuardCardTone,
    listingCreateGuardTone,
    listingCreatePrice,
    listingCreatePriceInvalid,
    listingCreatePriceValid,
    listingCreateRequiresBank,
    listingCreateRequiresBankAccount,
    listingCreateResult,
    listingCreateSelectedBankAccount,
    listingCreateSelectedBanks,
    listingCreateSelectedMethods,
    listingCreateTotalIls,
    listingCreateTradeRangeInvalid,
    listingCreationBlocked,
    listingCreationBlockedReason,
    locale,
    marketInsightsCard,
    marketPricePerUsdt,
    marketSnapshot,
    maxAllowedListingPrice,
    myListingsById,
    openCommissionPayment,
    openMarketplaceCompliancePayment,
    renderNotificationCenterCard,
    requestActionKey,
    reviewPayableCommissions,
    scrollToMyListingsSection,
    selectedCommissionWallet,
    selectedCommissionWalletAvailable,
    selectedCommissionWalletError,
    sellerApplication,
    sellerBankAccounts,
    sellerBankAccountsLoading,
    sellerCommissionStatus,
    sellerDeferredPanelsSentinelRef,
    sellerEvidenceFiles,
    sellerExpandedTradeId,
    sellerOverviewStats,
    sellerPrimaryRequestsExpanded,
    sellerRequestSections,
    sellerRequests,
    sellerResponseDrafts,
    sellerSafetyAcknowledgements,
    sellerTradeQuery,
    sellerTradeStatus,
    sellerWorkspaceMessage,
    sellerWorkspaceSummary,
    sessionUser,
    setCommissionAdvancedOpen,
    setCommissionCopied,
    setCommissionNetwork,
    setCommissionPayMessage,
    setCommissionPayOpen,
    setCommissionPayerType,
    setCommissionTxSignature,
    setListingCommissionAgreement,
    setListingCreateCurrencyManualOverride,
    setListingCreateForm,
    setListingCreateResult,
    setSellerDashboardListingsTarget,
    setSellerEvidenceFiles,
    setSellerExpandedTradeId,
    setSellerPrimaryRequestsExpanded,
    setSellerResponseDrafts,
    setSellerSafetyAcknowledgements,
    setSellerTradeQuery,
    setSellerTradeStatus,
    setSellerWorkspaceMessage,
    sortedSellerRequests,
    uploadTradeEvidenceFile,
    ISRAELI_BANKS,
    CompactTradeTimeline,
    LocalizedEvidenceFileInput,
    formatIls,
    formatUsdt,
    formatIntegerForInput,
    normalizeDecimalInput,
    renderBankLogo,
    shortListingRef,
    shortTradeRef,
    getTradeQueuePresentation,
    formatRelativeMinutesLabel,
    sellerLevelLabel,
    sellerBadgeLabel,
    requiresBankSelection,
    toggleSelection,
    paymentMethodLabel,
    paymentMethodEmoji,
    paymentMethodTradeInstruction,
    safeText,
    sellerAccountStatusLabel,
    spokenLanguageLabel,
    toNumber,
    tradeStatusLabel,
  } = props;

  return (
<div className="mt-6 flex flex-col gap-5 xl:gap-6">
          {/* Seller Dashboard Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0D0D0D] via-[#0A0A0A] to-[#111827]/60 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
            <div className="pointer-events-none absolute inset-0 opacity-30">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(201,162,39,0.18),transparent_40%),radial-gradient(circle_at_90%_80%,rgba(147,197,253,0.1),transparent_40%)]" />
            </div>
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1.5 text-xs text-[#F4D87A]">
                  <span className="font-semibold uppercase tracking-[0.12em]">{isAr ? "حالة البائع" : "Seller Status"}</span>
                  <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} />
                  <span className="text-[#E5E7EB]">{isAr ? "بائع معتمد" : "Approved Seller"}</span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {isAr ? `مرحباً بعودتك، ${sessionUser?.fullName?.split(" ")[0] ?? "البائع"}` : `Welcome back, ${sessionUser?.fullName?.split(" ")[0] ?? "Seller"}`}
                </h2>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  {isAr ? "تاريخ الموافقة" : "Approval Date"}: {new Date((sellerApplication?.updatedAt ?? sessionUser?.createdAt) || Date.now()).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-1 text-xs font-medium text-[#F4D87A]">
                    <Trophy className="h-3 w-3" />
                    {isAr ? `بائع ${sellerLevelLabel(sellerOverviewStats.reputation?.level, true)}` : `${sellerLevelLabel(sellerOverviewStats.reputation?.level)} Seller`}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#93C5FD]/30 bg-[#93C5FD]/10 px-3 py-1 text-xs text-[#93C5FD]">
                    <ShieldCheck className="h-3 w-3" />
                    {isAr ? "الثقة" : "Trust"} {(sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-1 text-xs text-[#86EFAC]">
                    <Star className="h-3 w-3" />
                    {(sellerOverviewStats.reputation?.rating ?? 0).toFixed(2)} {isAr ? "تقييم" : "Rating"}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs text-[#D1D5DB] sm:min-w-[180px]">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s Market"}</p>
                <p className="mt-1 text-base font-semibold text-white">USDT/ILS {formatIls(marketPricePerUsdt)}</p>
                <div className="mt-2 space-y-0.5">
                  {sellerOverviewStats.activeListings > 0 && <p>• {sellerOverviewStats.activeListings} {isAr ? "عروض نشطة" : `Active Listing${sellerOverviewStats.activeListings !== 1 ? "s" : ""}`}</p>}
                  {sellerOverviewStats.pendingRequests > 0 && <p>• {sellerOverviewStats.pendingRequests} {isAr ? "طلبات شراء" : `Purchase Request${sellerOverviewStats.pendingRequests !== 1 ? "s" : ""}`}</p>}
                  {sellerOverviewStats.reputation?.completedTrades !== undefined && <p className="text-[#9CA3AF]">• {sellerOverviewStats.reputation.completedTrades} {isAr ? "إجمالي الصفقات" : "Total Trades"}</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {isWorkspaceWidgetsLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Card key={`seller-stat-skeleton-${index}`} className="border-white/10 bg-[#0B0B0B]/90">
                    <CardContent className="space-y-2.5 p-5">
                      <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                      <div className="h-8 w-36 animate-pulse rounded bg-white/10" />
                    </CardContent>
                  </Card>
                ))
              : null}
            {!isWorkspaceWidgetsLoading
              ? [
              { label: isAr ? "العروض النشطة" : "Active Listings", value: sellerOverviewStats.activeListings.toLocaleString("en-IL"), icon: TrendingUp },
              { label: isAr ? "الصفقات المعلقة" : "Pending Trades", value: sellerOverviewStats.pendingRequests.toLocaleString("en-IL"), icon: MessageCircle },
              { label: isAr ? "مستوى البائع" : "Seller Level", value: sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr), icon: Trophy },
              { label: isAr ? "درجة الثقة" : "Trust Score", value: (sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1), icon: ShieldCheck },
              { label: isAr ? "التقييم" : "Rating", value: (sellerOverviewStats.reputation?.rating ?? 0).toFixed(2), icon: Star },
              { label: isAr ? "حجم التداول الكلي" : "Lifetime Volume", value: `₪${sellerOverviewStats.revenueGenerated.toFixed(2)}`, icon: WalletCards },
              { label: isAr ? "متوسط وقت الاستجابة" : "Average Response Time", value: sellerOverviewStats.averageResponseTime, icon: Clock3 },
              { label: isAr ? "مشاهدات الملف" : "Profile Views", value: (sellerOverviewStats.reputation?.profileViews ?? 0).toLocaleString("en-IL"), icon: Users },
            ].map((stat) => (
              <Card key={stat.label} className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader className="pb-1.5">
                  <CardDescription className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em]">
                    <stat.icon className="h-3.5 w-3.5 text-[#C9A227]" />
                    {stat.label}
                  </CardDescription>
                  <CardTitle className="text-xl tracking-tight">{stat.value}</CardTitle>
                </CardHeader>
              </Card>
            )) : null}
          </div>

          <Card id="commission-status" tabIndex={-1} className={`order-15 scroll-mt-24 border-white/10 bg-[#0B0B0B]/90 ${sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? "border-red-600/60" : ""}`}>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                {isAr ? "حالة العمولة" : "Commission Status"}
              </CardTitle>
              <CardDescription>
                {isAr ? "تتقاضى Alpha Traders عمولة بنسبة 1% على الصفقات المكتملة. تمنع العمولات غير المدفوعة إنشاء عروض جديدة أو تجديدها." : "Alpha Traders charges a 1% commission on completed trades. Pending commission payments block new listing creation and renewals."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? (
                <div className="rounded-2xl border border-red-600/60 bg-red-950/60 p-4 text-sm text-red-100">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div className="flex-1 space-y-2">
                      <p className="font-semibold text-base">{sellerCommissionStatus.status === "overdue" ? (isAr ? "العمولة متأخرة" : "Commission Overdue") : (isAr ? "عمولة مستحقة" : "Commission Due")}</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-red-300">{isAr ? "المبلغ المستحق" : "Amount outstanding"}</span>
                          <span className="font-bold text-white text-sm">{formatUsdt(commissionTotalAmountDue)}</span>
                        </div>
                        {sellerCommissionStatus.relatedTradeDisplayNumber ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">{isAr ? "مرجع الصفقة" : "Trade reference"}</span>
                            <span className="font-medium text-white">{isAr ? "الصفقة" : "Trade"} #{sellerCommissionStatus.relatedTradeDisplayNumber}</span>
                          </div>
                        ) : null}
                        {sellerCommissionStatus.dueAt ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">{isAr ? "تاريخ الاستحقاق" : "Due date"}</span>
                            <span className="font-medium text-white">{new Date(sellerCommissionStatus.dueAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm text-emerald-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="font-medium">{isAr ? "لا توجد عمولة مستحقة — حسابك سليم." : "No commission due — you’re all clear."}</span>
                  </div>
                </div>
              )}
              {sellerWorkspaceSummary?.blockedReason ? (
                <p className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-100">⚠ {isAr && !containsArabicText(sellerWorkspaceSummary.blockedReason) ? "مساحة عمل البائع مقيدة حالياً. راجع حالة العمولة أو الامتثال." : sellerWorkspaceSummary.blockedReason}</p>
              ) : null}
              {commissionWorkspaceAction.kind === "pay-one" ? (
                <Button
                  type="button"
                  onClick={() => openCommissionPayment(commissionWorkspaceAction.commissionId)}
                  className="h-10 px-4 bg-red-600 hover:bg-red-700 text-white border-red-600"
                >
                  {isAr ? "ادفع الآن" : "Pay Now"}
                </Button>
              ) : null}
              {commissionWorkspaceAction.kind === "review-unpaid" ? (
                <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium text-amber-100">{isAr ? "اختر عمولة غير مدفوعة لتسديدها." : "Choose one unpaid commission to pay."}</p>
                  <div className="grid gap-2">
                    {(sellerCommissionStatus?.payableRecords ?? []).map((record) => (
                      <Button
                        key={record.commissionId}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-auto min-h-10 justify-between px-3 text-start"
                        onClick={() => openCommissionPayment(record.commissionId)}
                      >
                        <span>
                          {record.relatedTradeDisplayNumber ? `${isAr ? "الصفقة" : "Trade"} #${record.relatedTradeDisplayNumber}` : (isAr ? "سجل العمولة" : "Commission record")}
                        </span>
                        <span className="text-[#FDE68A]">{formatUsdt(record.amountDue)}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {sellerCommissionStatus?.selectionError ? (
                <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                  {isAr && !containsArabicText(sellerCommissionStatus.selectionError) ? "تعذّر تحديد العمولة. اختر سجلاً غير مدفوع وحاول مرة أخرى." : sellerCommissionStatus.selectionError}
                </p>
              ) : null}
            </CardContent>
          </Card>
          {commissionPayOpen ? (
            <Card id="commission-payment" className="order-16 border-[#C9A227]/30 bg-[#0B0B0B]/98">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                    {isAr ? "دفع العمولة" : "Commission Payment"}
                  </CardTitle>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-[#6B7280] hover:text-white" onClick={() => setCommissionPayOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {/* Amount badge */}
                <div className="flex items-center gap-3 rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/5 px-4 py-3 mt-1">
                  <div className="flex-1">
                    <p className="text-xs text-[#9CA3AF]">{isAr ? "ادفع هذه العمولة" : "Pay this commission"}</p>
                    <p className="text-2xl font-bold text-white">{formatUsdt(commissionPayableAmountDue)}</p>
                  </div>
                  {sellerCommissionStatus?.relatedTradeDisplayNumber ? (
                    <div className="text-end">
                      <p className="text-xs text-[#9CA3AF]">{isAr ? "الصفقة" : "Trade"}</p>
                      <p className="text-sm font-medium text-[#C9A227]">#{sellerCommissionStatus.relatedTradeDisplayNumber}</p>
                    </div>
                  ) : null}
                </div>
                {sellerCommissionStatus && sellerCommissionStatus.pendingCount > 1 ? (
                  <p className="text-xs text-[#D1D5DB]">
                    {isAr ? `إجمالي المستحق ${formatUsdt(commissionTotalAmountDue)} موزع على ${sellerCommissionStatus.pendingCount} عمولات. هذه الدفعة تسدد الصفقة المحددة أعلاه فقط.` : `Total outstanding: ${formatUsdt(commissionTotalAmountDue)} across ${sellerCommissionStatus.pendingCount} commissions. This payment settles only the selected trade above.`}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-5">

                {/* ── Step 0: Payer type selection ── */}
                {!commissionPayerType ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-white">{isAr ? "كيف ستدفع العمولة؟" : "How are you paying your commission?"}</p>
                    <div className="grid gap-3">
                      {/* Personal Wallet */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("personal"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-start transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 group-hover:border-emerald-400/60">
                          <Wallet className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">{isAr ? "محفظة شخصية" : "Personal Wallet"}</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">MetaMask · Phantom · Trust Wallet · Rabby · Ledger · Trezor</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">{isAr ? "أرسل مباشرةً من محفظتك. ستحاول Alpha Traders اكتشاف دفعتك تلقائياً." : "Send directly from your wallet. Alpha Traders will attempt to detect your payment automatically."}</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                      {/* Exchange / Broker */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("exchange"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-start transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-950/40 group-hover:border-blue-400/60">
                          <Building2 className="h-5 w-5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">{isAr ? "منصة تداول أو وسيط" : "Crypto Exchange or Broker"}</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">Binance · Bybit · OKX · Coinbase · Kraken · Bitget · MEXC</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">{isAr ? "بعد الإرسال، الصق رمز معاملة السحب للتحقق من دفعتك." : "After sending, paste the withdrawal transaction hash to verify your payment."}</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                    </div>
                    <Button type="button" variant="ghost" className="w-full text-[#6B7280] hover:text-white text-xs" onClick={() => setCommissionPayOpen(false)}>
                      {isAr ? "إلغاء" : "Cancel"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* ── Back + payer type badge ── */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setCommissionPayerType(null); setCommissionPayMessage(null); }} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-white transition-colors">
                        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                        {isAr ? "رجوع" : "Back"}
                      </button>
                      <span className="text-[#6B7280]">·</span>
                      <span className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                        {commissionPayerType === "personal" ? <><Wallet className="h-3.5 w-3.5 text-emerald-400" />{isAr ? "محفظة شخصية" : "Personal Wallet"}</> : <><Building2 className="h-3.5 w-3.5 text-blue-400" />{isAr ? "منصة / وسيط" : "Exchange / Broker"}</>}
                      </span>
                    </div>

                    {/* ── Network selector ── */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">{isAr ? "شبكة الدفع" : "Payment Network"}</p>
                      <div className="grid gap-2">
                        {COMMISSION_NETWORKS.map((net) => {
                          const selected = commissionNetwork === net.id;
                          const networkAvailable = Boolean(commissionWalletConfiguration?.[net.id]?.available && CLIENT_COMMISSION_WALLETS[net.id]);
                          return (
                            <button
                              key={net.id}
                              type="button"
                              disabled={!networkAvailable}
                              onClick={() => setCommissionNetwork(net.id)}
                              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start transition-all ${networkAvailable ? (selected ? "border-[#C9A227] bg-[#C9A227]/10 text-white" : "border-white/12 bg-black/20 text-[#9CA3AF] hover:border-white/25 hover:text-white") : "cursor-not-allowed border-red-500/30 bg-red-950/20 text-red-200 opacity-75"}`}
                            >
                              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[#C9A227]" : "border-white/30"}`}>
                                {selected ? <div className="h-2 w-2 rounded-full bg-[#C9A227]" /> : null}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{net.label}</span>
                                {net.recommended ? <span className="ms-2 text-xs text-[#C9A227]">⭐ {isAr ? "موصى بها" : "Recommended"}</span> : null}
                                {!networkAvailable ? <span className="ms-2 text-xs text-red-200">{isAr ? "غير متاحة" : "Unavailable"}</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Recipient address + QR ── */}
                    {selectedCommissionWalletAvailable ? (
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
                          {isAr ? "إرسال إلى" : "Send To"} · {COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}
                        </p>
                        <div className="flex items-center gap-2">
                          <code dir="ltr" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-left text-xs font-mono text-white break-all select-all">
                            {selectedCommissionWallet}
                          </code>
                          <Button
                            type="button" size="sm" variant="secondary"
                            className="shrink-0 h-8 w-8 p-0"
                            onClick={() => { void navigator.clipboard.writeText(selectedCommissionWallet); setCommissionCopied(true); window.setTimeout(() => setCommissionCopied(false), 2000); }}
                          >
                            {commissionCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        {commissionQrDataUrl ? (
                          <div className="flex justify-center pt-1">
                            <div className="rounded-xl bg-white p-3 shadow-lg">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={commissionQrDataUrl} alt={isAr ? `رمز QR لعنوان USDT على شبكة ${commissionNetwork}` : `QR code for ${commissionNetwork} USDT address`} className="h-36 w-36" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-center">
                            <div className="flex h-[168px] w-[168px] items-center justify-center rounded-xl border border-white/10 bg-black/30">
                              <Loader2 className="h-6 w-6 animate-spin text-[#C9A227]" />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-300">
                        {selectedCommissionWalletError}
                      </p>
                    )}

                    {/* ── Instructions panel ── */}
                    {commissionPayerType === "personal" ? (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                          <Wallet className="h-3.5 w-3.5" />
                          {isAr ? "الإرسال من محفظة شخصية" : "Sending from a Personal Wallet"}
                        </p>
                        <ol className="space-y-2">
                          {[
                            isAr ? "افتح محفظتك واضغط على إرسال أو تحويل." : "Open your wallet and tap Send or Transfer.",
                            isAr ? `اختر شبكة ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.` : `Select the ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork} network.`,
                            isAr ? "اختر USDT كعملة الإرسال." : "Select USDT as the token.",
                            isAr ? "الصق عنوان عمولة Alpha Traders الظاهر أعلاه." : "Paste the Alpha Traders commission address above.",
                            isAr ? `أدخل المبلغ الدقيق: ${formatUsdt(commissionPayableAmountDue)}.` : `Enter the exact amount: ${formatUsdt(commissionPayableAmountDue)}.`,
                            isAr ? "أكد الإرسال وانتظر تأكيد المعاملة." : "Confirm and send. Wait for the transaction to be confirmed.",
                          ].map((step, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-950/60 text-emerald-400 text-[10px] font-bold">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <p className="text-xs text-[#6B7280] pt-1">
                          {isAr ? "⚠️ تأكد أن المعاملة إرسال USDT وليست مبادلة أو إيداعاً أو تفاعلاً آخر مع عقد." : "⚠️ Make sure the transaction is a USDT send — not a swap, deposit, or any other contract interaction."}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                          <Building2 className="h-3.5 w-3.5" />
                          {isAr ? "الإرسال من منصة تداول أو وسيط" : "Sending from an Exchange or Broker"}
                        </p>
                        <ol className="space-y-2">
                          {[
                            isAr ? `انتقل إلى صفحة السحب أو الإرسال في المنصة واختر USDT على شبكة ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.` : `Go to your exchange's Withdraw or Send page and select USDT on ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.`,
                            isAr ? "الصق عنوان عمولة Alpha Traders كمستلم." : "Paste the Alpha Traders commission address as the recipient.",
                            isAr ? `أدخل المبلغ الدقيق: ${formatUsdt(commissionPayableAmountDue)}.` : `Enter the exact amount: ${formatUsdt(commissionPayableAmountDue)}.`,
                            isAr ? "أكد السحب وانتظر تأكيد شبكة البلوك تشين." : "Confirm the withdrawal and wait for blockchain confirmation.",
                            isAr ? "انسخ رمز معاملة السحب من سجل المنصة." : "Copy the withdrawal transaction hash from your exchange history.",
                            isAr ? "الصقه أدناه واضغط على التحقق." : "Paste it below and click Verify.",
                          ].map((step, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-950/60 text-blue-400 text-[10px] font-bold">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* ── Transaction hash ── */}
                    {commissionPayerType === "personal" ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => setCommissionAdvancedOpen((v) => !v)}
                          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-[#9CA3AF] hover:text-white transition-colors"
                        >
                          <span className="font-medium">{isAr ? "تحقق يدوي — الصق رمز المعاملة" : "Manual Verification — paste transaction hash"}</span>
                          {commissionAdvancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        {commissionAdvancedOpen ? (
                          <div className="mt-2 space-y-1 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                            <Input
                              dir="ltr"
                              placeholder={isAr ? "0x… أو توقيع Solana" : "0x… or Solana signature"}
                              value={commissionTxSignature}
                              onChange={(event) => setCommissionTxSignature(event.target.value)}
                             onPaste={(event) => {
                               event.preventDefault();
                               setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                             }}
                             className="text-left font-mono text-xs"
                           />
                           <p className="text-xs text-[#6B7280]">
                             {isAr ? "ستجده في نشاط المحفظة أو سجل المعاملات. يجب أن يكون معاملة إرسال USDT، وليس مبادلة أو صفقة أو تفاعلاً آخر." : "Find this in your wallet’s Activity or Transaction History. It must be the USDT send transaction — not a swap, trade, or other interaction."}
                           </p>
                         </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">{isAr ? "رمز المعاملة" : "Transaction Hash"}</p>
                        <Input
                         dir="ltr"
                         placeholder={isAr ? "0x… أو توقيع Solana" : "0x… or Solana signature"}
                         value={commissionTxSignature}
                         onChange={(event) => setCommissionTxSignature(event.target.value)}
                         onPaste={(event) => {
                           event.preventDefault();
                           setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                         }}
                         className="text-left font-mono text-xs"
                        />
                        <p className="text-xs text-[#6B7280]">{isAr ? "انسخ هذا الرمز من سجل السحب في المنصة بعد تأكيد المعاملة." : "Copy this from your exchange withdrawal history after the transaction is confirmed."}</p>
                      </div>
                    )}

                    {/* ── Error / success message ── */}
                    {commissionPayMessage ? (
                      (() => {
                        const msg = commissionPayMessage;
                        if (msg.startsWith("✅")) {
                          return (
                            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                              <span>{isAr && !containsArabicText(msg) ? "تم التحقق من دفع العمولة بنجاح." : msg.replace("✅ ", "")}</span>
                            </div>
                          );
                        }
                        const wrongNetwork = msg.match(/found on (\w+), not (\w+)/i);
                        if (wrongNetwork) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? `تم العثور على المعاملة على شبكة ${wrongNetwork[1]}` : `Transaction found on ${wrongNetwork[1]}`}
                              </p>
                              <p>{isAr ? <>اختر <strong>{wrongNetwork[1]}</strong> كشبكة الدفع ثم أرسل المعاملة مرة أخرى.</> : <>Please select <strong>{wrongNetwork[1]}</strong> as your payment network and submit the transaction again.</>}</p>
                            </div>
                          );
                        }
                        if (msg.includes("but not the supported USDT contract") || msg.includes("send USDT (not USDC")) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? "تم اكتشاف عملة غير صحيحة" : "Wrong token detected"}
                              </p>
                              <p>{isAr ? "نقلت هذه المعاملة عملة مختلفة. يجب دفع العمولة بعملة USDT." : "This transaction transferred a different token. Commission must be paid in USDT."}</p>
                            </div>
                          );
                        }
                        if (msg.includes("does not include any transfer to or from the Alpha Traders commission wallet") || msg.includes("Please verify you submitted the correct transaction hash")) {
                          return (
                            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs space-y-1 text-red-100">
                              <p className="flex items-center gap-1.5 font-semibold text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? "هذه المعاملة ليست دفعة العمولة" : "Transaction is not your commission payment"}
                              </p>
                              <p>{isAr ? "تم العثور على المعاملة، لكنها لا تتضمن تحويلاً إلى محفظة عمولات Alpha Traders. أرسل رمز المعاملة الدقيق لدفعة USDT الموضحة أعلاه." : "We found this transaction, but it does not include a transfer to the Alpha Traders commission wallet. Please submit the exact transaction hash from when you sent the USDT payment above."}</p>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                            <span>{isAr && !containsArabicText(msg) ? "تعذّر التحقق من الدفعة. تأكد من التفاصيل وحاول مرة أخرى." : msg}</span>
                          </div>
                        );
                      })()
                    ) : null}

                    {/* ── Actions ── */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        disabled={commissionPayBusy || !commissionTxSignature.trim() || !selectedCommissionWalletAvailable}
                        onClick={() => void handleCommissionPayNow()}
                        className="bg-[#C9A227] hover:bg-[#B8911F] text-black font-semibold border-[#C9A227]"
                      >
                        {commissionPayBusy ? <><Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />{isAr ? "جارٍ التحقق…" : "Verifying…"}</> : (isAr ? "التحقق من الدفع" : "Verify Payment")}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setCommissionPayOpen(false)}>
                        {isAr ? "إلغاء" : "Cancel"}
                      </Button>
                    </div>
                  </div>
                )}

              </CardContent>
            </Card>
          ) : null}

          <Card id="create-listing" className="order-30 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "إنشاء عرض جديد" : "Create Listing"}</CardTitle>
              <CardDescription>
                {isAr ? "يتم إرسال العرض للمراجعة أولًا قبل نشره في السوق." : "Listings are submitted to owner review before publishing live."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {listingCreationBlocked ? (
                <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <p className="font-semibold">{isAr ? "إنشاء العروض متوقف حالياً" : "Listing creation is currently blocked"}</p>
                  <p className="mt-1 text-xs text-[#FDE68A]">{isAr && !containsArabicText(listingCreationBlockedReason) ? "راجع العروض النشطة أو العمولات أو حالة الامتثال لمعرفة الإجراء المطلوب." : listingCreationBlockedReason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {listingBlockedByActiveLimit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void scrollToMyListingsSection();
                        }}
                      >
                        {isAr ? "إدارة العروض" : "Manage Listings"}
                      </Button>
                    ) : null}
                    {listingBlockedByCommission && commissionWorkspaceAction.kind === "pay-one" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => openCommissionPayment(commissionWorkspaceAction.commissionId)}>
                        {isAr ? "ادفع الآن" : "Pay Now"}
                      </Button>
                    ) : null}
                    {listingBlockedByCommission && commissionWorkspaceAction.kind === "review-unpaid" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={reviewPayableCommissions}>
                        {isAr ? "مراجعة العمولات غير المدفوعة" : "Review Unpaid Commissions"}
                      </Button>
                    ) : null}
                    {listingBlockedByMarketplaceEnforcement ? (
                      <Button type="button" size="sm" variant="secondary" onClick={openMarketplaceCompliancePayment}>
                        {isAr ? "فتح امتثال السوق" : "Open Marketplace Compliance"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className={`mb-4 rounded-2xl border p-4 text-sm text-[#E5E7EB] transition-all duration-200 ${listingCreateGuardCardTone}`}>
                <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "حماية سعر السوق المباشر" : "Live Market Price Guard"}</p>
                <p className={`mt-1 text-xs ${marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}`}>
                  {marketSnapshot?.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "السوق غير متاح مؤقتاً — يتم استخدام آخر سعر معروف." : "Market temporarily unavailable — using last known price.")}
                </p>
                <div className="mt-2 space-y-1">
                  <p>1 USDT = <span className="font-semibold text-white">{formatIls(marketPricePerUsdt)}</span></p>
                  <p>{isAr ? "أقصى سعر للعرض" : "Maximum listing price"}: <span className="font-semibold text-white">{formatIls(maxAllowedListingPrice)}</span></p>
                  {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ <span className="font-semibold text-white">{formatIls(listingCreateAmount * marketPricePerUsdt)}</span></p> : null}
                </div>
              </div>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSellerListingCreateSubmit}>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-available" required>{isAr ? "USDT المتاح" : "Available USDT"}</FieldLabel>
                  <Input
                    id="create-available"
                    placeholder={isAr ? "مثال: 25,000" : "e.g. 25,000"}
                    value={listingCreateForm.availableAmount}
                    onChange={(event) => {
                      const nextAmount = formatIntegerForInput(event.target.value);
                      setListingCreateForm((prev) => ({ ...prev, availableAmount: nextAmount, maximumTrade: nextAmount }));
                    }}
                    aria-required
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.availableAmount, required: true }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "يتم التنسيق تلقائيًا أثناء الكتابة." : "Amount is auto-formatted while typing (e.g. 25,000)."}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-price" required>{isAr ? "السعر" : "Price"}</FieldLabel>
                  <Input
                    id="create-price"
                    placeholder={isAr ? "السعر لكل USDT" : "Price per USDT"}
                    value={listingCreateForm.price}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                    aria-required
                    aria-invalid={listingCreatePriceInvalid || undefined}
                    className={cn("h-11 transition-all duration-200", requiredFieldClasses({ value: listingCreateForm.price, required: true, invalid: listingCreatePriceInvalid }))}
                  />
                  <p className={`text-xs transition-colors duration-200 ${
                    listingCreatePriceInvalid ? "text-red-300" : listingCreatePriceValid ? "text-emerald-300" : "text-[#9CA3AF]"
                  }`}>
                    {listingCreatePriceInvalid
                      ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)}).` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`)
                      : listingCreatePriceValid
                        ? (isAr ? `السعر صالح. الحد الأقصى المسموح هو ${formatIls(maxAllowedListingPrice)}.` : `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`)
                        : (isAr ? `أدخل سعراً لا يتجاوز ${formatIls(maxAllowedListingPrice)}.` : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`)}
                  </p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-currency" required>{isAr ? "العملة" : "Currency"}</FieldLabel>
                  <Input
                    id="create-currency"
                    placeholder="ILS"
                    value={listingCreateForm.currency}
                    onChange={(event) => {
                      setListingCreateCurrencyManualOverride(true);
                      setListingCreateForm((prev) => ({ ...prev, currency: formatIntegerForInput(event.target.value) }));
                    }}
                    className="h-11"
                  />
                  <p className={`text-xs ${listingCreateCurrencyManualOverride ? "text-amber-300" : "text-emerald-300"}`}>
                    {listingCreateCurrencyManualOverride ? (isAr ? "إدخال يدوي" : "Manual Override") : (isAr ? "محسوب تلقائياً" : "Auto Calculated")}
                  </p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-network" required>{isAr ? "الشبكة" : "Network"}</FieldLabel>
                  <select id="create-network" className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white transition focus:border-[#C9A227]/60 focus:outline-none focus:ring-2 focus:ring-[#C9A227]/30" value={listingCreateForm.network} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                    <option value="TRC20">TRC20</option>
                    <option value="ERC20">ERC20</option>
                    <option value="BEP20">BEP20</option>
                    <option value="SOL">SOL</option>
                  </select>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "طريقة الدفع" : "Payment Method"}</FieldLabel>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {MARKETPLACE_PAYMENT_METHODS.map((method) => {
                      const selected = listingCreateSelectedMethods.includes(method);
                      return (
                        <button
                          key={`create-method-${method}`}
                          type="button"
                          onClick={() => setListingCreateForm((prev) => {
                            const nextMethods = toggleSelection(prev.paymentMethods, method, MAX_LISTING_PAYMENT_METHODS);
                            return {
                              ...prev,
                              paymentMethods: nextMethods,
                              bankName: requiresBankSelection(nextMethods) ? prev.bankName : "",
                            };
                          })}
                          className={`rounded-xl border p-3 text-start transition-all duration-200 ${
                            selected
                              ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                              : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? `اختر حتى ${MAX_LISTING_PAYMENT_METHODS} طرق. يختار المشتري طريقة واحدة عند فتح الصفقة.` : `Select up to ${MAX_LISTING_PAYMENT_METHODS} methods. Buyers choose one method when they open the trade.`}</p>
                  <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? <>راجع إرشادات أمان الدفع في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Review payment safety guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-min-trade" required>{isAr ? "أدنى صفقة" : "Minimum Trade"}</FieldLabel>
                  <Input
                    id="create-min-trade"
                    placeholder={isAr ? "أدنى مبلغ" : "Smallest amount"}
                    value={listingCreateForm.minimumTrade}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))}
                    aria-required
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.minimumTrade, required: true }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "أصغر مبلغ صفقة تقبله." : "The smallest trade amount you are willing to accept."}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-max-trade" required>{isAr ? "أقصى صفقة" : "Maximum Trade"}</FieldLabel>
                  <Input
                    id="create-max-trade"
                    placeholder={isAr ? "أكبر مبلغ" : "Largest amount"}
                    value={listingCreateForm.maximumTrade}
                    onChange={(event) => setListingCreateForm((prev) => {
                      const listedAmount = toNumber(prev.availableAmount);
                      if (listedAmount <= 0) {
                        return { ...prev, maximumTrade: "" };
                      }
                      const requestedMax = toNumber(formatIntegerForInput(event.target.value));
                      const clampedMax = Math.min(requestedMax || 0, listedAmount);
                      return { ...prev, maximumTrade: clampedMax > 0 ? formatIntegerForInput(clampedMax) : "" };
                    })}
                    aria-required
                    aria-invalid={listingCreateTradeRangeInvalid || undefined}
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.maximumTrade, required: true, invalid: listingCreateTradeRangeInvalid }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "لا يمكن أن يتجاوز مبلغ USDT المعروض." : "Maximum trade cannot exceed your listed USDT amount."}</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <FieldLabel htmlFor="create-description" optional optionalLabel={isAr ? "اختياري" : "optional"}>{isAr ? "وصف البائع" : "Seller Description"}</FieldLabel>
                  <Textarea id="create-description" className="min-h-[96px]" placeholder={isAr ? "أخبر المشترين عن شروطك" : "Tell buyers about your terms"} value={listingCreateForm.sellerDescription} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} />
                </div>
                {listingCreateRequiresBank ? (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "البنوك المدعومة" : "Supported banks"}</FieldLabel>
                  <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? `اختر حتى ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} بنوك للتحويل البنكي أو السحب بلا بطاقة.` : `Select up to ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.`}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {ISRAELI_BANKS.map((bank) => {
                      const selected = listingCreateSelectedBanks.includes(bank.name);
                      return (
                        <button
                          key={bank.id}
                          type="button"
                          onClick={() => setListingCreateForm((prev) => {
                            const nextBanks = toggleSelection(parseIsraeliBankSelection(prev.bankName), bank.name, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS);
                            return { ...prev, bankName: serializeIsraeliBankSelection(nextBanks) };
                          })}
                          className={`rounded-xl border p-3 text-start transition-all duration-200 ${
                            selected
                              ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                              : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/35">
                              {renderBankLogo(bank)}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-white">{getIsraeliBankDisplayName(bank.name, locale)}</p>
                              <p className="text-[11px] text-[#9CA3AF]">{bank.code}</p>
                            </div>
                          </div>
                          {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "محدد" : "Selected"}</p> : null}
                        </button>
                      );
                    })}
                  </div>
                  {listingCreateSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">{isAr ? "المحدد" : "Selected"}: {listingCreateSelectedBanks.map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</p> : null}
                </div>
                ) : null}
                {listingCreateRequiresBankAccount ? (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "حساب البنك لاستلام الدفع" : "Payout bank account"}</FieldLabel>
                  {sellerBankAccountsLoading ? (
                    <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? "جارٍ تحميل الحسابات البنكية..." : "Loading saved bank accounts..."}</p>
                  ) : sellerBankAccounts.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-300">
                      {isAr ? "لا توجد حسابات بنكية محفوظة. أضف حسابًا في" : "No saved bank accounts found. Add one in"} <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">{isAr ? "الإعدادات" : "Settings"}</a>.
                    </p>
                  ) : (
                    <>
                      <select
                        className="mt-2 flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white"
                        value={listingCreateForm.bankAccountId}
                        onChange={(event) => setListingCreateForm((prev) => {
                          const bankAccountId = event.target.value;
                          const selectedAccount = sellerBankAccounts.find((account) => account.id === bankAccountId);
                          const nextBanks = ensurePayoutBankIsSupported(
                            parseIsraeliBankSelection(prev.bankName),
                            selectedAccount?.bankName,
                            MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
                          );
                          return {
                            ...prev,
                            bankAccountId,
                            bankName: serializeIsraeliBankSelection(nextBanks),
                          };
                        })}
                      >
                        <option value="">{isAr ? "اختر الحساب البنكي" : "Select bank account"}</option>
                        {sellerBankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {`${getIsraeliBankDisplayName(account.bankName, locale)} • ${account.maskedAccountNumber ?? `****${account.accountLast4}`}${account.isDefault ? (isAr ? " (افتراضي)" : " (Default)") : ""}`}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "رقم الحساب الكامل يظل مخفيًا عن المشترين حتى بداية الصفقة." : "Your full account number stays hidden from buyers until the trade starts."}</p>
                    </>
                  )}
                </div>
                ) : null}
                <div className="md:col-span-2 rounded-2xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-4 text-sm text-[#E5E7EB]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "القيمة الإجمالية المباشرة" : "Live total value"}</p>
                  <p className="mt-1">{listingCreateAmount.toLocaleString("en-IL")} USDT</p>
                  <p className="mt-1">× {formatIls(listingCreatePrice || 0)} = <span className="font-semibold text-white">{formatIls(listingCreateTotalIls)}</span></p>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm text-[#F3F4F6]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#F4D87A]">{isAr ? "عمولة المنصة" : "Platform Commission"}</p>
                  <p className="mt-1">{isAr ? "تتقاضى Alpha Traders عمولة بنسبة 1% على الصفقات المكتملة. بنشر هذا العرض، توافق على دفع عمولة المنصة بعد نجاح الصفقة." : "Alpha Traders charges a 1% commission on completed trades. By publishing this listing, you agree to pay the platform commission after a successful trade."}</p>
                  <label className="mt-3 inline-flex cursor-pointer items-start gap-2 text-xs text-[#E5E7EB]">
                    <input
                      type="checkbox"
                      checked={listingCommissionAgreement}
                      onChange={(event) => setListingCommissionAgreement(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                    />
                    <span>{isAr ? "أفهم وأوافق على سياسة عمولة Alpha Traders البالغة 1%." : "I understand and agree to Alpha Traders’ 1% commission policy."}</span>
                  </label>
                  <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? <>اقرأ السياسة كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full policy in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                </div>
                <div className={`md:col-span-2 rounded-2xl border p-4 transition-all duration-200 ${listingCreateGuardTone}`}>
                  <div className="flex items-start gap-2">
                    {listingCreatePriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {listingCreatePriceInvalid ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)})` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})`) : (isAr ? "حماية سعر السوق مفعلة" : "Market guard active")}
                      </p>
                      <p>{isAr ? "سعر السوق الحالي" : "Current market"}: {formatIls(marketPricePerUsdt)} {isAr ? "لكل 1 USDT" : "per 1 USDT"}</p>
                      <p>{isAr ? "الحد الأقصى المسموح" : "Maximum allowed"}: {formatIls(maxAllowedListingPrice)}</p>
                      {listingCreateTradeRangeInvalid ? <p className="text-amber-200">{isAr ? "يجب أن يكون الحد الأقصى للصفقة أكبر من الحد الأدنى وألا يتجاوز كمية USDT المتاحة." : "Maximum trade must be greater than minimum trade and less than or equal to available USDT."}</p> : null}
                      {listingCreateRequiresBank && !listingCreateSelectedBanks.length ? <p className="text-amber-200">{isAr ? "اختر بنكاً واحداً أو بنكين مدعومين قبل الإرسال." : "Select one or two supported banks before submitting."}</p> : null}
                      {listingCreateRequiresBankAccount && !listingCreateForm.bankAccountId ? <p className="text-amber-200">{isAr ? "اختر حساباً بنكياً واحداً لاستلام الدفعات قبل الإرسال." : "Select one payout bank account before submitting."}</p> : null}
                      {listingCreateBankAccountMismatch ? (
                        <p className="text-red-200">
                          {listingCreateSelectedBankAccount
                            ? (isAr ? `يجب أن تشمل البنوك المدعومة بنك استلام الدفعات (${getIsraeliBankDisplayName(listingCreateSelectedBankAccount.bankName, "ar")}).` : `Supported banks must include your payout bank (${getIsraeliBankDisplayName(listingCreateSelectedBankAccount.bankName, "en")}).`)
                            : (isAr ? "حساب استلام الدفعات المحدد لم يعد متاحاً. اختر حساباً بنكياً محفوظاً مرة أخرى." : "Your selected payout bank account is no longer available. Choose a saved bank account again.")}
                        </p>
                      ) : null}
                      {!listingCommissionAgreement ? <p className="text-amber-200">{isAr ? "يجب الموافقة على سياسة العمولة بنسبة 1% قبل النشر." : "You must accept the 1% commission policy before publishing."}</p> : null}
                      {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingCreateAmount * marketPricePerUsdt)}</p> : null}
                    </div>
                  </div>
                </div>
                {listingCreateResult ? (
                  <div
                    id="listing-publish-result"
                    tabIndex={-1}
                    role={listingCreateResult.tone === "error" ? "alert" : "status"}
                    aria-live={listingCreateResult.tone === "error" ? "assertive" : "polite"}
                    className={cn(
                      "md:col-span-2 flex items-start justify-between gap-3 rounded-xl border p-4 text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.03)] animate-in fade-in-0 slide-in-from-top-1 duration-300",
                      listingCreateResult.tone === "error"
                        ? "border-red-500/45 bg-red-950/35 text-red-100"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {listingCreateResult.tone === "error" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      )}
                      <span>{isAr && !containsArabicText(listingCreateResult.message) ? (listingCreateResult.tone === "error" ? "تعذّر نشر العرض. راجع الحقول وحاول مرة أخرى." : "تم إرسال العرض للمراجعة بنجاح.") : listingCreateResult.message}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={isAr ? "إغلاق نتيجة نشر العرض" : "Dismiss listing result"}
                      onClick={() => setListingCreateResult(null)}
                      className={cn(
                        "shrink-0 rounded-full p-0.5 transition hover:text-white",
                        listingCreateResult.tone === "error" ? "text-red-300" : "text-emerald-300",
                      )}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <Button type="submit" className="h-11 w-full sm:w-auto" disabled={isListingCreateSubmitDisabled || listingActionKey === "create:new"}>
                    {listingActionKey === "create:new" ? (isAr ? "جارٍ النشر..." : "Publishing...") : (isAr ? "إرسال العرض" : "Submit Listing")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {sellerWorkspaceMessage ? (
            <div id="listing-publish-result" tabIndex={-1} role="status" aria-live="polite" className="order-25 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] animate-in fade-in-0 slide-in-from-top-1 duration-300">
              <span>{isAr && !containsArabicText(sellerWorkspaceMessage) ? "تم تحديث مساحة عمل البائع بنجاح." : sellerWorkspaceMessage}</span>
              <button
                type="button"
                aria-label={isAr ? "إغلاق" : "Dismiss"}
                onClick={() => setSellerWorkspaceMessage(null)}
                className="shrink-0 rounded-full p-0.5 text-emerald-300 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <Card id="purchase-requests-section" tabIndex={-1} className="order-5 scroll-mt-24 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "طلبات الشراء" : "Purchase Requests"}</CardTitle>
              <CardDescription>{isAr ? "إدارة طلبات المشترين الواردة لك." : "Manage incoming buyer purchase requests."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input placeholder={isAr ? "ابحث بمعرّف الصفقة أو المشتري أو العرض..." : "Search by trade ID, buyer, listing..."} value={sellerTradeQuery} onChange={(event) => setSellerTradeQuery(event.target.value)} />
                <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerTradeStatus} onChange={(event) => setSellerTradeStatus(event.target.value as typeof sellerTradeStatus)}>
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
              {isWorkspaceWidgetsLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <div key={`seller-requests-skeleton-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-white/10" />
                  </div>
                ))
              ) : null}
              {!isWorkspaceWidgetsLoading && sellerRequests.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
                  <MessageCircle className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد طلبات شراء قيد الانتظار" : "No purchase requests yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "عند استلام أول طلب شراء، ستتمكن من الرد عليه فورًا من هنا." : "Your next buyer request will appear here with quick actions to accept, decline, or continue the trade."}</p>
                </div>
              ) : null}
              {(sellerRequestSections.action.length || sellerRequestSections.active.length || sellerRequestSections.waiting.length) ? (
                <div className="space-y-3">
                  {sellerRequestSections.action.length ? (
                    <div className="rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-2 text-xs font-medium text-[#FDE68A]">
                      {isAr ? "تحتاج إلى إجراء منك" : "Requires Your Action"} · {sellerRequestSections.action.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.active.length ? (
                    <div className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs font-medium text-white">
                      {isAr ? "صفقات نشطة" : "Active Trades"} · {sellerRequestSections.active.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.waiting.length ? (
                    <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-3 py-2 text-xs font-medium text-[#BFDBFE]">
                      {isAr ? "قيد الانتظار" : "Waiting"} · {sellerRequestSections.waiting.length}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(sellerPrimaryRequestsExpanded
                ? sortedSellerRequests
                : sortedSellerRequests.slice(0, isMobileViewport ? 1 : 2)
              ).map((request) => {
                const presentation = getTradeQueuePresentation(request, "seller", isAr);
                const isExpanded = sellerExpandedTradeId === request.id;
                return (
                  <div id={`trade-${request.id}`} key={request.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      className="grid w-full gap-3 px-4 py-3 text-start transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_auto] md:items-center"
                      aria-expanded={isExpanded}
                      aria-controls={`seller-trade-details-${request.id}`}
                      onClick={() => setSellerExpandedTradeId((previous) => previous === request.id ? null : request.id)}
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{shortTradeRef(request, isAr)}</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "المشتري" : "Buyer"} {safeText(request.buyerName, isAr ? "مشتري" : "Buyer")}</p>
                        {request.priceMode === "buyer_offer" ? (
                          <span className="mt-1.5 inline-flex rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] font-semibold text-[#F4D87A]">
                            {isAr ? "عرض سعر" : "Price Offer"} · ₪{toNumber(request.pricePerUsdt).toFixed(2)}/USDT
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs">
                        <span className={`rounded-full border px-2.5 py-1 font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                      </div>
                      <div className="text-sm text-[#D1D5DB]">
                        <p>{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</p>
                      </div>
                      <p className="text-xs text-[#9CA3AF]">{new Date(request.updatedAt || request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</p>
                      <p className="text-sm text-[#C9A227] md:text-end">{isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "عرض" : "View")}</p>
                    </button>
                    {isExpanded ? (
                    <div id={`seller-trade-details-${request.id}`} className="border-t border-white/10 bg-black/25 px-4 py-4">
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>{isAr ? "مرجع الصفقة" : "Trade Ref"}: <span className="text-white">{shortTradeRef(request, isAr)}</span></p>
                      <p>{isAr ? "اسم المشتري" : "Buyer Name"}: <span className="text-white">{request.buyerName}</span></p>
                      <p>{isAr ? "كمية USDT" : "USDT Amount"}: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                      <p>{isAr ? "المبلغ بالعملة التقليدية" : "Fiat Amount"}: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
                      <p>{request.priceMode === "buyer_offer" ? (isAr ? "سعر المشتري المقترح" : "Buyer Offered Price") : (isAr ? "السعر لكل USDT" : "Price per USDT")}: <span className={request.priceMode === "buyer_offer" ? "font-semibold text-[#F4D87A]" : "text-white"}>₪{(toNumber(request.pricePerUsdt) || (toNumber(request.fiatAmount) / Math.max(1, toNumber(request.usdtAmount)))).toFixed(2)}</span></p>
                      {request.priceMode === "buyer_offer" ? <p>{isAr ? "سعر العرض الأصلي" : "Original Listing Price"}: <span className="text-white">₪{toNumber(request.listingPriceAtRequest).toFixed(2)}</span></p> : null}
                      <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{request.network}</span></p>
                      <p>{isAr ? "طريقة الدفع" : "Payment Method"}: <span className="text-white">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod, isAr)}</span></p>
                      <p>{isAr ? "العرض" : "Listing"}: <span className="text-white">{shortListingRef({ id: request.listingId, displayNumber: myListingsById.get(request.listingId)?.displayNumber })}</span></p>
                      <p>{isAr ? "تاريخ الإرسال" : "Submitted"}: <span className="text-white">{new Date(request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                      <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{tradeStatusLabel(request.status, isAr)}</span></p>
                      {request.completedAt ? <p>{isAr ? "اكتملت" : "Completed"}: <span className="text-white">{new Date(request.completedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                      {request.reviewUnlockedAt ? <p>{isAr ? "تم فتح التقييم" : "Review Unlocked"}: <span className="text-white">{new Date(request.reviewUnlockedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} {isAr ? "تعليمات الصفقة" : "Trade Instructions"}</p>
                      <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "seller", isAr)}</p>
                    </div>
                    {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)" && request.status === "pending" ? (
                      <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">{isAr ? "إرشادات الأمان" : "Safety Guidelines"}</p>
                        <p className="mt-1 text-[#E5E7EB]">{isAr ? "التقيا في أماكن عامة فقط، ويفضل الأماكن المزودة بكاميرات، ولا تشارك معلومات شخصية غير ضرورية، وتأكد من تحويل USDT قبل المغادرة." : "Meet only in public places, prefer camera-covered locations, avoid sharing unnecessary personal details, and confirm USDT transfer before leaving."}</p>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={sellerSafetyAcknowledgements[request.id] ?? false}
                            onChange={(event) => setSellerSafetyAcknowledgements((prev) => ({ ...prev, [request.id]: event.target.checked }))}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>{isAr ? "قرأت إرشادات الأمان هذه وأوافق عليها." : "I have read and agree to these safety guidelines."}</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">{isAr ? <>اقرأ الإرشادات كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onMouseEnter={() => handlePrefetchTradeRoom(request.id)}
                        onFocus={() => handlePrefetchTradeRoom(request.id)}
                        onClick={() => handleOpenTradeRoom(request.id)}
                      >
                        {isAr ? "فتح غرفة التداول" : "Open Trade Room"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          request.status !== "pending"
                          || Boolean(sellerWorkspaceSummary?.pendingCommissionCount)
                          || requestActionKey === `${request.id}:accepted`
                          || (normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)" && !(sellerSafetyAcknowledgements[request.id] ?? false))
                        }
                        onClick={() => handleSellerRequestAction(request.id, "accepted", { safetyAcknowledged: sellerSafetyAcknowledgements[request.id] ?? false })}
                      >
                        {requestActionKey === `${request.id}:accepted` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : request.priceMode === "buyer_offer" ? (isAr ? "قبول عرض السعر" : "Accept Price Offer") : (isAr ? "قبول" : "Accept")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" || requestActionKey === `${request.id}:declined`} onClick={() => handleSellerRequestAction(request.id, "declined")}>
                        {requestActionKey === `${request.id}:declined` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : request.priceMode === "buyer_offer" ? (isAr ? "رفض عرض السعر" : "Decline Price Offer") : (isAr ? "رفض" : "Decline")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "payment_sent" || requestActionKey === `${request.id}:funds_received`}
                        onClick={() => handleSellerRequestAction(request.id, "funds_received")}
                      >
                        {requestActionKey === `${request.id}:funds_received`
                          ? (isAr ? "جارٍ التنفيذ..." : "Processing...")
                          : normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? (isAr ? "تأكيد استلام النقد" : "Confirm Cash Collected") : (isAr ? "تأكيد استلام الأموال" : "Confirm Funds Received")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "funds_received" || requestActionKey === `${request.id}:usdt_release_pending`}
                        onClick={() => handleSellerRequestAction(request.id, "usdt_release_pending")}
                      >
                        {requestActionKey === `${request.id}:usdt_release_pending` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "بدء إرسال USDT" : "Start USDT Release")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_release_pending" || !request.sellerEvidence || requestActionKey === `${request.id}:usdt_sent`} onClick={() => handleSellerRequestAction(request.id, "usdt_sent")}>
                        {requestActionKey === `${request.id}:usdt_sent` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "تحديد USDT كمُرسل" : "Mark USDT Sent")}
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                      <div>
                        <p className="font-medium text-white">{isAr ? "إثبات المشتري" : "Buyer Evidence"}</p>
                        {request.buyerEvidence ? (
                          <a
                            href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline"
                          >
                            {request.buyerEvidence.fileName}
                          </a>
                        ) : (
                          <p className="mt-1 text-[#9CA3AF]">{isAr ? "لم يتم الرفع بعد." : "Not uploaded yet."}</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Evidence"}</p>
                        {request.sellerEvidence ? (
                          <a
                            href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline"
                          >
                            {request.sellerEvidence.fileName}
                          </a>
                        ) : (
                          <p className="mt-1 text-[#9CA3AF]">{isAr ? "يجب رفع الإثبات قبل تحديد USDT كمُرسل." : "Upload required before marking USDT sent."}</p>
                        )}
                      </div>
                      {!request.sellerEvidence ? (
                        <div className="md:col-span-2">
                          <p className="text-sm font-semibold text-white">{isAr ? "رفع إثبات البائع" : "Upload seller evidence"}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <LocalizedEvidenceFileInput
                              id={`seller-evidence-file-${request.id}`}
                              isAr={isAr}
                              selectedFile={sellerEvidenceFiles[request.id] ?? null}
                              onSelect={(file) => {
                                setSellerEvidenceFiles((prev) => ({ ...prev, [request.id]: file }));
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!sellerEvidenceFiles[request.id] || evidenceUploading[`${request.id}:seller`]}
                              onClick={() => {
                                const file = sellerEvidenceFiles[request.id];
                                if (!file) return;
                                void uploadTradeEvidenceFile(request.id, "seller", file);
                              }}
                            >
                              {evidenceUploading[`${request.id}:seller`] ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4">
                      <CompactTradeTimeline events={request.timeline ?? []} isAr={isAr} />
                    </div>
                    {request.buyerReview ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">{isAr ? "تقييم المشتري" : "Buyer Review"}</p>
                        <p className="mt-1">{request.buyerReview.comment}</p>
                      </div>
                    ) : null}
                    {request.buyerReview && !request.sellerResponse ? (
                      <form
                        className="mt-3 grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSubmitSellerResponse(request);
                        }}
                      >
                        <Textarea aria-label={isAr ? "الرد على تقييم المشتري" : "Respond to buyer review"} placeholder={isAr ? "اكتب ردك على تقييم المشتري" : "Respond to buyer review"} value={sellerResponseDrafts[request.id] ?? ""} onChange={(event) => setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                        <div>
                          <Button type="submit" size="sm" variant="secondary">{isAr ? "إرسال رد البائع" : "Submit Seller Response"}</Button>
                        </div>
                      </form>
                    ) : null}
                    {request.sellerResponse ? (
                      <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">{isAr ? "رد البائع" : "Seller Response"}</p>
                        <p className="mt-1">{request.sellerResponse.message}</p>
                      </div>
                    ) : null}
                    </div>
                    ) : null}
                  </div>
                );
              })}
              {sortedSellerRequests.length > (isMobileViewport ? 1 : 2) ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSellerPrimaryRequestsExpanded((prev) => !prev)}
                  >
                    {sellerPrimaryRequestsExpanded
                      ? (isAr ? "عرض أقل" : "Show less")
                      : (isAr ? `عرض الكل (${sortedSellerRequests.length - (isMobileViewport ? 1 : 2)})` : `View All (${sortedSellerRequests.length - (isMobileViewport ? 1 : 2)})`)}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <div ref={setSellerDashboardListingsTarget} className="order-5" />

          <div className="order-6">
            {renderNotificationCenterCard("notification-center-section")}
          </div>

          <div ref={sellerDeferredPanelsSentinelRef} className="order-39 h-px w-full" aria-hidden />
          {deferredSellerPanelsReady ? (
            <div className="order-40 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              <Card className="order-50 border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle>{isAr ? "ملف البائع" : "Seller Profile"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                  <div className="flex items-center gap-3">
                    {sessionUser?.profilePhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sessionUser.profilePhotoUrl} alt={isAr ? `صورة ${sessionUser.fullName}` : `${sessionUser.fullName} profile`} className="h-13 w-13 rounded-full border border-white/15 object-cover" />
                    ) : (
                      <div className="inline-flex h-13 w-13 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-sm font-semibold text-[#D1D5DB]">
                        {safeText(sessionUser?.fullName, isAr ? "بائع" : "Seller")
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="text-base font-semibold text-white"><bdi dir="auto">{safeText(sessionUser?.fullName, isAr ? "بائع" : "Seller")}</bdi></p>
                      <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} />
                    </div>
                  </div>
                  <p>{isAr ? "عضو منذ" : "Member Since"}: <span className="text-white"><bdi dir="ltr">{sessionUser?.createdAt ? new Date(sessionUser.createdAt).toLocaleDateString(isAr ? "ar-IL-u-nu-latn" : "en-IL") : "—"}</bdi></span></p>
                  <p>{isAr ? "اللغات" : "Languages"}: <span className="text-white"><bdi dir="auto">{sessionUser?.languages?.length ? sessionUser.languages.map((language) => spokenLanguageLabel(language, isAr)).join(isAr ? "، " : ", ") : (isAr ? "العربية" : "English")}</bdi></span></p>
                  <p>{isAr ? "الشبكات المفضلة" : "Preferred Networks"}: <span className="text-white"><bdi dir="ltr">{sessionUser?.preferredNetworks?.join(", ") || "TRC20"}</bdi></span></p>
                  <p>{isAr ? "التقييم" : "Rating"}: <span className="text-white"><bdi dir="ltr">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}</bdi></span></p>
                  <p>{isAr ? "نسبة النجاح" : "Success Rate"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.successRate.toFixed(1)}{isAr ? "٪" : "%"}</bdi></span></p>
                  <p>{isAr ? "الصفقات المكتملة" : "Completed Trades"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.completedTrades}</bdi></span></p>
                  <p>{isAr ? "إجمالي حجم USDT" : "Total USDT Volume"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")} USDT</bdi></span></p>
                  <p>{isAr ? "العروض الحالية" : "Current Listings"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.activeListings}</bdi></span></p>
                  <p>{isAr ? "متوسط وقت الاستجابة" : "Average Response Time"}: <span className="text-white">{sellerOverviewStats.averageResponseTime}</span></p>
                  <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{sessionUser?.onlineStatus === "online" ? (isAr ? "متصل" : "Online") : (isAr ? "غير متصل" : "Offline")}</span></p>
                  <p>{isAr ? "آخر نشاط" : "Last Active"}: <span className="text-white">{formatRelativeMinutesLabel(sessionUser?.lastActiveAt, isAr)}</span></p>
                  <p>{isAr ? "نبذة" : "Bio"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.bio, isAr ? "بائع USDT محترف على Alpha Exchange." : "Professional USDT seller on Alpha Exchange.")}</bdi></span></p>
                  <p>{isAr ? "خبرة التداول" : "Trading Experience"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.tradingExperience, isAr ? "خبرة احترافية في التداول" : "Professional trading experience")}</bdi></span></p>
                  <p>{isAr ? "ساعات العمل" : "Working Hours"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.workingHours, isAr ? "الأحد-الخميس، 09:00-21:00" : "Sun-Thu, 09:00-21:00")}</bdi></span></p>
                  <p>{isAr ? "حالة الحساب" : "Account Status"}: <span className="text-white">{sellerAccountStatusLabel(sessionUser?.sellerStatus, isAr)}</span></p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(sellerOverviewStats.reputation?.badges ?? []).map((badge) => (
                      <span key={badge} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-1 text-[11px] text-[#93C5FD]">
                        {sellerBadgeLabel(badge, isAr)}
                      </span>
                    ))}
                  </div>
                  {sellerOverviewStats.completedTrades === 0 ? (
                    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">
                      {isAr ? "لا توجد صفقات مكتملة بعد. أكمل أول صفقة لبناء سجل ثقة قوي." : "No Trades Yet. Complete your first trade to start building trust history."}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {marketInsightsCard}

              <Card className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle>{isAr ? "لوحة البائع" : "Seller Command Center"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "حجم التداول الكلي" : "Lifetime Trade Volume"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")} USDT</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "متوسط التقييم" : "Average Rating"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}★</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الصفقات المكتملة" : "Completed Trades"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.completedTrades.toLocaleString("en-IL")}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "مستوى البائع" : "Seller Level"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-[#0B0B0B]/90 xl:col-span-2">
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
            </div>
          ) : (
            <Card className="order-40 border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle>{isAr ? "جاري تحميل الرؤى المتقدمة" : "Advanced insights load on demand"}</CardTitle>
                <CardDescription>
                  {isAr
                    ? "تظهر الإشعارات، التحليلات، والملفات الثانوية عند فتح هذا الجزء لتسريع التفاعل الأولي."
                    : "Notifications, analytics, and secondary reputation widgets hydrate when this section comes into view so the shell stays fast."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={`deferred-seller-panel-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-44 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-white/10" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
  );
}
