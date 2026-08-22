import { describe, expect, it } from "vitest";
import { buildMarketplaceEmail } from "@/lib/marketplace-email-delivery";
import { sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import {
  DIRECT_CONTACT_CONTENT_ERROR,
  assertNoDirectContactContent,
  findDirectContactContent,
  redactPhoneNumbers,
  redactPrivateContactDetails,
} from "@/lib/privacy-redaction";
import type { AlphaExchangeNotification, PurchaseRequest } from "@/types/alpha-exchange";

const BUYER_PHONE = "+972 50-123-4567";
const SELLER_PHONE = "0509876543";
const INTERNATIONAL_PHONE = "+1 (202) 555-0123";
const BUYER_EMAIL = "buyer-private@example.test";
const BUYER_TELEGRAM = "@buyer_private";
const BUYER_CONTACT_URL = "https://t.me/buyer_private";

const request = {
  id: "request-privacy",
  buyerId: "buyer-privacy",
  sellerId: "seller-privacy",
  buyerName: "Buyer",
  buyerWhatsapp: BUYER_PHONE,
  buyerNotes: `Email ${BUYER_EMAIL} or Telegram ${BUYER_TELEGRAM}`,
  status: "accepted",
} as PurchaseRequest;

describe("phone privacy boundaries", () => {
  it("keeps legacy Buyer contact metadata out of every participant trade DTO", () => {
    for (const actor of [
      ["seller-privacy", "approved_seller"],
      ["buyer-privacy", "buyer"],
    ] as const) {
      const redacted = sanitizePurchaseRequestForActor(request, actor[0], actor[1]);
      expect(redacted).not.toHaveProperty("buyerWhatsapp");
      expect(redacted).not.toHaveProperty("buyerNotes");
      expect(JSON.stringify(redacted)).not.toContain(BUYER_PHONE);
      expect(JSON.stringify(redacted)).not.toContain(BUYER_EMAIL);
      expect(JSON.stringify(redacted)).not.toContain(BUYER_TELEGRAM);
    }
    const adminAuditView = sanitizePurchaseRequestForActor(request, "admin-privacy", "admin");
    expect(adminAuditView.buyerWhatsapp).toBe(BUYER_PHONE);
    expect(adminAuditView.buyerNotes).toContain(BUYER_EMAIL);
  });

  it("redacts direct contact details from notification text", () => {
    const notification = {
      id: "notification-privacy",
      userId: "seller-privacy",
      category: "trade",
      title: `Buyer contact ${BUYER_PHONE}`,
      message: `Call ${SELLER_PHONE} or ${INTERNATIONAL_PHONE}; email ${BUYER_EMAIL}; Telegram ${BUYER_TELEGRAM}; ${BUYER_CONTACT_URL}`,
      isRead: false,
      createdAt: new Date().toISOString(),
    } satisfies AlphaExchangeNotification;
    expect(redactPhoneNumbers(notification.title)).not.toContain("123-4567");
    const redacted = redactPrivateContactDetails(notification.message);
    expect(redacted).not.toContain("0509876543");
    expect(redacted).not.toContain("555-0123");
    expect(redacted).not.toContain(BUYER_EMAIL);
    expect(redacted).not.toContain(BUYER_TELEGRAM);
    expect(redacted).not.toContain(BUYER_CONTACT_URL);
    expect(redactPrivateContactDetails("Call 555-123-4567")).toBe("Call [private contact removed]");
  });

  it("redacts direct contact details from email subject, text, HTML, and action URLs", () => {
    const email = buildMarketplaceEmail({
      event: "trade_completed",
      recipientName: `Buyer ${BUYER_PHONE}`,
      title: `Trade update ${SELLER_PHONE}`,
      message: `Private contact ${BUYER_PHONE}, ${BUYER_EMAIL}, ${BUYER_TELEGRAM}, ${BUYER_CONTACT_URL}`,
      actionLabel: "Open Trade Room",
      actionUrl: BUYER_CONTACT_URL,
      referenceLabel: SELLER_PHONE,
    });
    expect(email.subject).not.toContain(SELLER_PHONE);
    expect(email.text).not.toContain("123-4567");
    expect(email.html).not.toContain("0509876543");
    expect(email.subject).not.toContain(BUYER_EMAIL);
    expect(email.text).not.toContain(BUYER_TELEGRAM);
    expect(email.text).not.toContain(BUYER_CONTACT_URL);
    expect(email.html).not.toContain(BUYER_CONTACT_URL);
    expect(email.text).toContain("[private contact removed]");
  });

  it("does not expose a phone number through an error-safe redaction boundary", () => {
    expect(redactPhoneNumbers(`Invalid contact value: ${BUYER_PHONE}`)).toBe("Invalid contact value: [private contact removed]");
  });

  it("detects clear off-platform contact forms through one canonical policy", () => {
    expect(findDirectContactContent("Email buyer @ example . test")).toBe("email");
    expect(findDirectContactContent("Call 050-123-4567 when ready")).toBe("phone");
    expect(findDirectContactContent("Call +972 50 123 4567 when ready")).toBe("phone");
    expect(findDirectContactContent("Call 555-123-4567 when ready")).toBe("phone");
    expect(findDirectContactContent("WhatsApp https://wa.me/972501234567")).toBe("contact_url");
    expect(findDirectContactContent("Telegram: @buyer_private")).toBe("telegram");
    expect(findDirectContactContent("mailto:buyer-private@example.test")).toBe("contact_url");
    expect(findDirectContactContent("tel:+972501234567")).toBe("contact_url");
    expect(findDirectContactContent("Message me on WhatsApp")).toBe("contact_platform");
    expect(() => assertNoDirectContactContent("https://t.me/buyer_private")).toThrow(DIRECT_CONTACT_CONTENT_ERROR);
  });

  it("does not mistake payment values, wallets, or transaction hashes for direct contact", () => {
    expect(findDirectContactContent("Price is 3.64 ILS for 250 USDT.")).toBeNull();
    expect(findDirectContactContent("Wallet 0x52908400098527886E0F7030069857D2E4169EE7")).toBeNull();
    expect(findDirectContactContent("Transaction 5d41402abc4b2a76b9719d911017c592")).toBeNull();
    expect(findDirectContactContent("Bank account 0123456789, branch 123")).toBeNull();
    expect(findDirectContactContent("Bank account 123-456-789, branch 123")).toBeNull();
  });

  it("redacts the complete direct-contact URL before number redaction can leave a clickable fragment", () => {
    const redacted = redactPrivateContactDetails("Use https://wa.me/972501234567 or https://t.me/buyer_private");
    expect(redacted).toBe("Use [private contact removed] or [private contact removed]");
    expect(redacted).not.toContain("wa.me");
    expect(redacted).not.toContain("t.me");
  });
});
