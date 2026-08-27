import { describe, expect, it } from "vitest";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
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

const sevenDigits = () => String(randomInt(1_000_000, 10_000_000));
const fourDigits = () => String(randomInt(1_000, 10_000));
const BUYER_PHONE_DIGITS = sevenDigits();
const SELLER_PHONE_DIGITS = sevenDigits();
const BUYER_PHONE = `+972 50-${BUYER_PHONE_DIGITS.slice(0, 3)}-${BUYER_PHONE_DIGITS.slice(3)}`;
const SELLER_PHONE = `050${SELLER_PHONE_DIGITS}`;
const INTERNATIONAL_PHONE = `+1 (${String(randomInt(200, 999))}) ${String(randomInt(200, 999))}-${fourDigits()}`;
const BUYER_EMAIL = `privacy-${randomUUID()}@example.test`;
const BUYER_TELEGRAM = `@privacy_${randomBytes(6).toString("hex")}`;
const BUYER_CONTACT_URL = `https://t.me/${BUYER_TELEGRAM.slice(1)}`;
const WALLET_REFERENCE = `0x${randomBytes(20).toString("hex")}`;
const TRANSACTION_REFERENCE = randomBytes(16).toString("hex");
const BANK_ACCOUNT_REFERENCE = String(randomInt(1_000_000_000, 2_000_000_000));

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
    expect(redactPhoneNumbers(notification.title)).not.toContain(BUYER_PHONE_DIGITS);
    const redacted = redactPrivateContactDetails(notification.message);
    expect(redacted).not.toContain(SELLER_PHONE);
    expect(redacted).not.toContain(INTERNATIONAL_PHONE);
    expect(redacted).not.toContain(BUYER_EMAIL);
    expect(redacted).not.toContain(BUYER_TELEGRAM);
    expect(redacted).not.toContain(BUYER_CONTACT_URL);
    expect(redactPrivateContactDetails(`Call ${INTERNATIONAL_PHONE}`)).toBe("Call [private contact removed]");
  });

  it("redacts direct contact details from email subject, text, HTML, and action URLs", () => {
    const email = buildMarketplaceEmail({
      event: "trade_completed",
      recipientName: `Buyer ${BUYER_PHONE}`,
      title: {
        ar: `تحديث الصفقة ${SELLER_PHONE}`,
        en: `Trade update ${SELLER_PHONE}`,
      },
      message: {
        ar: `بيانات اتصال خاصة ${BUYER_PHONE}، ${BUYER_EMAIL}، ${BUYER_TELEGRAM}، ${BUYER_CONTACT_URL}`,
        en: `Private contact ${BUYER_PHONE}, ${BUYER_EMAIL}, ${BUYER_TELEGRAM}, ${BUYER_CONTACT_URL}`,
      },
      actionLabel: { ar: "فتح غرفة الصفقة", en: "Open Trade Room" },
      actionPath: `/trade-room/${BUYER_PHONE}`,
      referenceLabel: SELLER_PHONE,
    });
    expect(email.subject).not.toContain(SELLER_PHONE);
    expect(email.text).not.toContain(BUYER_PHONE);
    expect(email.html).not.toContain(SELLER_PHONE);
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
    expect(findDirectContactContent(`Email ${BUYER_EMAIL.replace("@", " @ ").replace(".", " . ")}`)).toBe("email");
    expect(findDirectContactContent(`Call ${SELLER_PHONE} when ready`)).toBe("phone");
    expect(findDirectContactContent(`Call ${BUYER_PHONE.replaceAll("-", " ")} when ready`)).toBe("phone");
    expect(findDirectContactContent(`Call ${INTERNATIONAL_PHONE} when ready`)).toBe("phone");
    expect(findDirectContactContent(`WhatsApp https://wa.me/${BUYER_PHONE.replace(/\D/g, "")}`)).toBe("contact_url");
    expect(findDirectContactContent(`Telegram: ${BUYER_TELEGRAM}`)).toBe("telegram");
    expect(findDirectContactContent(`mailto:${BUYER_EMAIL}`)).toBe("contact_url");
    expect(findDirectContactContent(`tel:${BUYER_PHONE.replace(/\D/g, "")}`)).toBe("contact_url");
    expect(findDirectContactContent("Message me on WhatsApp")).toBe("contact_platform");
    expect(() => assertNoDirectContactContent(BUYER_CONTACT_URL)).toThrow(DIRECT_CONTACT_CONTENT_ERROR);
  });

  it("does not mistake payment values, wallets, or transaction hashes for direct contact", () => {
    expect(findDirectContactContent("Price is 3.64 ILS for 250 USDT.")).toBeNull();
    expect(findDirectContactContent(`Wallet ${WALLET_REFERENCE}`)).toBeNull();
    expect(findDirectContactContent(`Transaction ${TRANSACTION_REFERENCE}`)).toBeNull();
    expect(findDirectContactContent(`Bank account ${BANK_ACCOUNT_REFERENCE}, branch 123`)).toBeNull();
    expect(findDirectContactContent(`Bank account ${BANK_ACCOUNT_REFERENCE.slice(0, 3)}-${BANK_ACCOUNT_REFERENCE.slice(3, 6)}-${BANK_ACCOUNT_REFERENCE.slice(6)}, branch 123`)).toBeNull();
  });

  it("redacts the complete direct-contact URL before number redaction can leave a clickable fragment", () => {
    const redacted = redactPrivateContactDetails(`Use https://wa.me/${BUYER_PHONE.replace(/\D/g, "")} or ${BUYER_CONTACT_URL}`);
    expect(redacted).toBe("Use [private contact removed] or [private contact removed]");
    expect(redacted).not.toContain("wa.me");
    expect(redacted).not.toContain("t.me");
  });
});
