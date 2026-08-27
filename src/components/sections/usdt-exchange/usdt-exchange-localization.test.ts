import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/image", () => ({ default: () => null }));

import {
  formatIsraelDateKey,
  formatIsraelMarketTime,
  localizeWalletValidationError,
  listingStatusLabel,
  localizedAuditAction,
  localizedTimelineMessage,
  marketTrendAriaLabel,
  marketReferenceLabel,
  sellerAccountStatusLabel,
  spokenLanguageLabel,
  tradeStatusLabel,
} from "@/components/sections/usdt-exchange/usdt-exchange-page";
import type { ListingStatus, PurchaseRequestStatus, TradeTimelineEntry, TradeTimelineEventType } from "@/types/alpha-exchange";

const ARABIC_TEXT = /[\u0600-\u06ff]/;

describe("USDT exchange localized mobile copy", () => {
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
      "request_accepted",
      "payment_sent",
      "seller_confirmed_funds",
      "usdt_release_started",
      "usdt_sent",
      "trade_completed",
      "trade_timed_out",
      "trade_locked",
      "review_unlocked",
      "dispute_opened",
      "commission_recorded",
      "commission_paid",
      "buyer_evidence_uploaded",
      "seller_evidence_uploaded",
      "request_declined",
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
