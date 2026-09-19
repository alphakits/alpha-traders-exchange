import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/image", () => ({ default: () => null }));

import {
  canCancelBuyerHistoryRequest,
  formatIls,
  formatIsraelDateKey,
  formatIsraelMarketTime,
  formatUsdt,
  greetingByTime,
  localizeWalletValidationError,
  listingStatusLabel,
  localizedAuditAction,
  localizedTimelineMessage,
  marketTrendAriaLabel,
  marketReferenceLabel,
  normalizeDecimalInput,
  paymentMethodTradeInstruction,
  sellerAccountStatusLabel,
  spokenLanguageLabel,
  tradeStatusLabel,
} from "@/components/sections/usdt-exchange/usdt-exchange-page";
import type { ListingStatus, PurchaseRequest, PurchaseRequestStatus, TradeTimelineEntry, TradeTimelineEventType } from "@/types/alpha-exchange";

const ARABIC_TEXT = /[\u0600-\u06ff]/;

describe("USDT exchange localized mobile copy", () => {
  it("groups every marketplace financial amount above 999", () => {
    expect(formatUsdt(1_000)).toBe("1,000.00 USDT");
    expect(formatUsdt(1.234567)).toBe("1.234567 USDT");
    expect(formatIls(1_050_000)).toBe("₪1,050,000.00");
  });

  it("accepts seller prices from Arabic and decimal-comma keyboards", () => {
    expect(normalizeDecimalInput("٣٫٢٣")).toBe("3.23");
    expect(normalizeDecimalInput("3,23")).toBe("3.23");
    expect(normalizeDecimalInput("1,000")).toBe("1000");
    expect(normalizeDecimalInput("3.2.3")).toBe("");
  });

  it("renders time-based greetings from one deterministic Israel timezone", () => {
    expect(greetingByTime(false, "2026-09-03T22:30:00.000Z")).toBe("Good morning");
    expect(greetingByTime(true, "2026-09-03T10:00:00.000Z")).toBe("مساء الخير");
    expect(greetingByTime(false, "2026-09-03T17:00:00.000Z")).toBe("Good evening");
    expect(greetingByTime(true, "not-a-date")).toBe("مرحباً");
  });

  it("enables buyer-history cancellation until payment evidence is submitted", () => {
    const pendingRequest = {
      id: "request-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "pending",
    } as PurchaseRequest;

    expect(canCancelBuyerHistoryRequest(pendingRequest, "buyer-1")).toBe(true);
    expect(canCancelBuyerHistoryRequest({ ...pendingRequest, status: "accepted" }, "buyer-1")).toBe(true);
    expect(canCancelBuyerHistoryRequest({ ...pendingRequest, status: "accepted", paymentSentAt: "2026-09-04T12:00:00.000Z" }, "buyer-1")).toBe(false);
    expect(canCancelBuyerHistoryRequest({ ...pendingRequest, status: "payment_sent" }, "buyer-1")).toBe(false);
    expect(canCancelBuyerHistoryRequest(pendingRequest, "seller-1")).toBe(false);
  });

  it("keeps cash-trade dashboard guidance aligned with the no-photo Trade Room sequence", () => {
    expect(paymentMethodTradeInstruction("Cardless ATM Withdrawal", "buyer", false)).toContain("send the withdrawal code to the seller");
    expect(paymentMethodTradeInstruction("Cardless ATM Withdrawal", "seller", false)).toContain("No photo is required");
    expect(paymentMethodTradeInstruction("Face-to-Face (Meet in Person)", "buyer", false)).toContain("seller separately confirms USDT sent");

    const buyerWorkspace = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/buyer-workspace-section.tsx"), "utf8");
    const sellerWorkspace = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/seller-workspace-section.tsx"), "utf8");
    expect(buyerWorkspace).toContain("Continue Cash Trade");
    expect(sellerWorkspace).toContain("Continue Cash Trade");
    expect(buyerWorkspace).not.toContain("Mark Withdrawal Ready");
    expect(buyerWorkspace).toContain("seller confirms USDT sent and then marks the trade completed");
    expect(sellerWorkspace).toContain("Confirm USDT sent first, then mark the trade completed with a separate button");

    const exchangePage = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/usdt-exchange-page.tsx"), "utf8");
    expect(exchangePage).toContain('cashTrade ? "confirm-usdt-sent" : "release-usdt"');
    expect(exchangePage).toContain('cashTrade && isSellerActor) action = "complete-cash-trade"');
    expect(exchangePage).toContain('!isCashTradePaymentMethod(request.paymentMethod)');
  });

  it("keeps public marketing sections out of authenticated workspaces", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/usdt-exchange-page.tsx"), "utf8");
    expect(source).toContain("showDeferredSections && !sessionUser && !isDashboardWorkspace");
    expect(source.match(/showDeepDeferredSections && !sessionUser && !isDashboardWorkspace/g)).toHaveLength(3);
  });

  it("never exposes raw market source identifiers in Arabic", () => {
    expect(marketReferenceLabel("Marketplace reference", "alpha-reference", true)).toBe("مرجع سوق Alpha Traders");
    expect(marketReferenceLabel(undefined, "coinbase-spot", true)).toBe("سوق Coinbase الفوري");
    expect(marketReferenceLabel("Unknown upstream", "unknown", true)).toBe("مصدر تسعير موثوق");
    expect(marketReferenceLabel(undefined, "coinbase-spot", false)).toBe("Coinbase spot market");
  });

  it("gives market trend graphics a fully localized screen-reader label", () => {
    expect(marketTrendAriaLabel("USDT / ILS", true)).toBe("رسم بياني مصغّر لحركة سعر USDT / ILS");
    expect(marketTrendAriaLabel("USDT / ILS", true)).not.toContain("sparkline");
    expect(marketTrendAriaLabel("USDT / ILS", false)).toBe("USDT / ILS price trend chart");
  });

  it("provides Arabic copy for every inline trade timeline event", () => {
    const eventTypes: TradeTimelineEventType[] = [
      "request_submitted",
      "price_offer_submitted",
      "request_accepted",
      "price_offer_accepted",
      "payment_sent",
      "seller_confirmed_funds",
      "usdt_release_started",
      "usdt_sent",
      "trade_completed",
      "trade_timed_out",
      "trade_locked",
      "review_unlocked",
      "dispute_opened",
      "dispute_resolved",
      "commission_recorded",
      "commission_paid",
      "buyer_evidence_uploaded",
      "seller_evidence_uploaded",
      "request_declined",
      "price_offer_declined",
      "request_cancelled",
      "buyer_confirmed_receipt",
      "buyer_confirmation_overdue",
      "trade_closed_manually",
      "trade_inactivity_warning_sent",
      "bank_details_revealed",
    ];

    for (const type of eventTypes) {
      const event: TradeTimelineEntry = {
        id: `event-${type}`,
        type,
        actorUserId: "user-1",
        actorRole: "buyer",
        message: "Raw English server event",
        createdAt: "2026-08-27T10:00:00.000Z",
      };
      expect(localizedTimelineMessage(event, true), type).toMatch(ARABIC_TEXT);
      expect(localizedTimelineMessage(event, true), type).not.toContain("Raw English server event");
      expect(localizedTimelineMessage(event, false), type).toBe("Raw English server event");
    }
  });

  it("keeps the expandable trade timeline summary at least 44px tall", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/usdt-exchange-page.tsx"), "utf8");
    const timelineStart = source.indexOf("function CompactTradeTimeline");
    const timelineEnd = source.indexOf("function LocalizedEvidenceFileInput", timelineStart);
    const timelineSource = source.slice(timelineStart, timelineEnd);

    expect(timelineStart).toBeGreaterThan(-1);
    expect(timelineEnd).toBeGreaterThan(timelineStart);
    expect(timelineSource).toContain('<summary className="flex min-h-11');
    expect(timelineSource).not.toContain('<summary className="flex min-h-8');
  });

  it("exposes both purchase paths with bilingual price-offer copy and a mobile-safe dialog", () => {
    const marketplace = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/usdt-exchange-page.tsx"), "utf8");
    const purchaseDialog = readFileSync(join(process.cwd(), "src/components/sections/usdt-exchange/purchase-listing-dialog.tsx"), "utf8");
    const tradeRoom = readFileSync(join(process.cwd(), "src/components/sections/trade-room/trade-room-page.tsx"), "utf8");

    expect(marketplace).toContain('onOpen(listing, "listing_price")');
    expect(marketplace).toContain('onOpen(listing, "buyer_offer")');
    expect(marketplace).toContain('"Seller Profile"');
    expect(marketplace).toContain('"Buy Now"');
    expect(marketplace).toContain('"Make an Offer"');
    expect(marketplace).toContain('"قدّم عرض سعر"');
    expect(marketplace).toContain('"Up to ₪0.35 lower"');
    expect(marketplace).toContain('"خصم حتى ₪0.35"');
    expect(marketplace).toContain('listing.currency.trim().toUpperCase() === "ILS"');
    expect(marketplace).toContain('seller-marketplace-action--offer');
    expect(purchaseDialog).toContain('id="buyer-offered-price"');
    expect(purchaseDialog).toContain('type="number"');
    expect(purchaseDialog).toContain('step="0.01"');
    expect(purchaseDialog).toContain('"Submit Price Offer"');
    expect(purchaseDialog).toContain('"إرسال عرض السعر"');
    expect(purchaseDialog).toContain('className="min-h-11 w-full"');
    expect(tradeRoom).toContain('"Price Offer Submitted"');
    expect(tradeRoom).toContain('"تم إرسال عرض السعر"');
    expect(tradeRoom).toContain('<summary className="flex min-h-11');
  });

  it("localizes audit codes instead of exposing internal English slugs", () => {
    expect(localizedAuditAction("seller_approved", true)).toBe("الموافقة على البائع");
    expect(localizedAuditAction("future_internal_action", true)).toBe("إجراء إداري");
    expect(localizedAuditAction("seller_approved", false)).toBe("Seller Approved");
  });

  it("formats market timestamps in Israel time for both locales", () => {
    expect(formatIsraelMarketTime("2026-08-27T10:00:00.000Z", false)).toBe("13:00");
    expect(formatIsraelMarketTime("2026-08-27T10:00:00.000Z", true)).toBe("13:00");
    expect(formatIsraelMarketTime(undefined, true)).toBe("--:--");
  });

  it("uses Israel calendar dates around UTC midnight", () => {
    expect(formatIsraelDateKey("2026-08-27T21:30:00.000Z")).toBe("2026-08-28");
    expect(formatIsraelDateKey("2026-12-31T22:30:00.000Z")).toBe("2027-01-01");
    expect(formatIsraelDateKey("not-a-date")).toBe("");
  });

  it("localizes wallet validation and every seller account status", () => {
    expect(localizeWalletValidationError("Wallet address is required", "TRC20", true)).toContain("مطلوب");
    expect(localizeWalletValidationError("Invalid address", "ERC20", true)).toContain("42");
    expect(sellerAccountStatusLabel("pending_seller_approval", true)).toBe("طلب البائع قيد المراجعة");
    expect(sellerAccountStatusLabel("suspended", true)).toBe("حساب البائع معلّق");
    expect(sellerAccountStatusLabel("rejected", false)).toBe("Seller application rejected");
  });

  it("keeps legacy spoken-language values safe in Arabic", () => {
    expect(spokenLanguageLabel("English", true)).toBe("الإنجليزية");
    expect(spokenLanguageLabel("Hebrew", true)).toBe("العبرية");
    expect(spokenLanguageLabel("Unknown Latin value", true)).toBe("لغة إضافية");
    expect(spokenLanguageLabel("لغة محلية", true)).toBe("لغة محلية");
  });

  it("localizes every valid listing and trade status without generic fallbacks", () => {
    const listingStatuses: ListingStatus[] = ["draft", "active", "paused", "matched", "in_trade", "expired", "completed", "cancelled", "closed"];
    const tradeStatuses: PurchaseRequestStatus[] = [
      "pending",
      "accepted",
      "payment_sent",
      "funds_received",
      "usdt_release_pending",
      "usdt_sent",
      "completed",
      "locked",
      "review_open",
      "declined",
      "cancelled",
    ];

    for (const status of listingStatuses) {
      expect(listingStatusLabel(status, true), status).toMatch(ARABIC_TEXT);
      expect(listingStatusLabel(status, true), status).not.toBe("قيد المراجعة");
    }
    for (const status of tradeStatuses) {
      expect(tradeStatusLabel(status, true), status).toMatch(ARABIC_TEXT);
      expect(tradeStatusLabel(status, true), status).not.toBe("قيد المعالجة");
    }
  });
});
