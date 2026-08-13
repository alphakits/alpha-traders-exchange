import { describe, expect, it } from "vitest";
import { buildMarketplaceEmail } from "@/lib/marketplace-email-delivery";
import { sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import { redactPhoneNumbers } from "@/lib/privacy-redaction";
import type { AlphaExchangeNotification, PurchaseRequest } from "@/types/alpha-exchange";

const BUYER_PHONE = "+972 50-123-4567";
const SELLER_PHONE = "0509876543";

const request = {
  id: "request-privacy",
  buyerId: "buyer-privacy",
  sellerId: "seller-privacy",
  buyerName: "Buyer",
  buyerWhatsapp: BUYER_PHONE,
  status: "accepted",
} as PurchaseRequest;

describe("phone privacy boundaries", () => {
  it("hides buyer contact from sellers while preserving buyer and admin access", () => {
    expect(sanitizePurchaseRequestForActor(request, "seller-privacy", "approved_seller")).not.toHaveProperty("buyerWhatsapp");
    expect(sanitizePurchaseRequestForActor(request, "buyer-privacy", "buyer").buyerWhatsapp).toBe(BUYER_PHONE);
    expect(sanitizePurchaseRequestForActor(request, "admin-privacy", "admin").buyerWhatsapp).toBe(BUYER_PHONE);
  });

  it("redacts phone numbers from notification text", () => {
    const notification = {
      id: "notification-privacy",
      userId: "seller-privacy",
      category: "trade",
      title: `Buyer contact ${BUYER_PHONE}`,
      message: `Call ${SELLER_PHONE} for help.`,
      isRead: false,
      createdAt: new Date().toISOString(),
    } satisfies AlphaExchangeNotification;
    expect(redactPhoneNumbers(notification.title)).not.toContain("123-4567");
    expect(redactPhoneNumbers(notification.message)).not.toContain("0509876543");
  });

  it("redacts phone numbers from email subject, text, and HTML", () => {
    const email = buildMarketplaceEmail({
      event: "trade_completed",
      recipientName: `Buyer ${BUYER_PHONE}`,
      title: `Trade update ${SELLER_PHONE}`,
      message: `Private contact ${BUYER_PHONE}`,
      actionLabel: "Open Trade Room",
      actionUrl: "https://example.test/trade-room/request-privacy",
      referenceLabel: SELLER_PHONE,
    });
    expect(email.subject).not.toContain(SELLER_PHONE);
    expect(email.text).not.toContain("123-4567");
    expect(email.html).not.toContain("0509876543");
    expect(email.text).toContain("[private contact removed]");
  });

  it("does not expose a phone number through an error-safe redaction boundary", () => {
    expect(redactPhoneNumbers(`Invalid contact value: ${BUYER_PHONE}`)).toBe("Invalid contact value: [private contact removed]");
  });
});