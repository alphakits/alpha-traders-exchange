import { describe, expect, it } from "vitest";
import { hasVerifiedPhoneForSms, toAdminSmsDelivery } from "@/lib/alpha-exchange-store";
import type { SmsDeliveryRecord } from "@/types/alpha-exchange";

describe("SMS delivery safeguards", () => {
  it("requires a valid verified phone before SMS can be enabled", () => {
    expect(hasVerifiedPhoneForSms({ verifiedPhone: "+15551234567", phoneVerifiedAt: "2026-08-06T10:00:00.000Z" })).toBe(true);
    expect(hasVerifiedPhoneForSms({ verifiedPhone: "+15551234567" })).toBe(false);
    expect(hasVerifiedPhoneForSms({ verifiedPhone: "055-1234567", phoneVerifiedAt: "2026-08-06T10:00:00.000Z" })).toBe(false);
  });

  it("returns the admin history shape with only a masked recipient", () => {
    const delivery: SmsDeliveryRecord = {
      id: "sms-1",
      eventKey: "trade:1:completed",
      eventType: "trade_completed",
      recipientUserId: "user-1",
      recipientPhone: "+15551234567",
      body: "private delivery content",
      status: "delivered",
      retryCount: 1,
      twilioMessageSid: "SM123",
      lastError: "Provider rejected +15551234567",
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:01:00.000Z",
      deliveredAt: "2026-08-06T10:01:00.000Z",
    };

    const adminDelivery = toAdminSmsDelivery(delivery);
    expect(adminDelivery).toEqual(expect.objectContaining({
      recipientPhoneMasked: "+15•••67",
      eventType: "trade_completed",
      status: "delivered",
      retryCount: 1,
      twilioMessageSid: "SM123",
    }));
    expect(adminDelivery).not.toHaveProperty("recipientPhone");
    expect(adminDelivery).not.toHaveProperty("body");
    expect(JSON.stringify(adminDelivery)).not.toContain("+15551234567");
    expect(adminDelivery.lastError).toBe("Provider rejected +15•••67");
  });
});
