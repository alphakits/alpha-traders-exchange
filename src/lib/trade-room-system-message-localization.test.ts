import { describe, expect, it } from "vitest";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";

const currentExactMessages = [
  [
    "Seller accepted the trade request. Buyer can now upload the payment receipt.",
    "وافق البائع على طلب الصفقة. يمكن للمشتري الآن رفع إيصال الدفع.",
  ],
  ["Buyer uploaded the payment receipt.", "رفع المشتري إيصال الدفع."],
  ["Seller attached release evidence.", "أرفق البائع إثبات إرسال USDT."],
  [
    "Buyer submitted payment. Seller should now confirm the money was received.",
    "أرسل المشتري الدفع. يجب على البائع الآن تأكيد استلام الأموال.",
  ],
  [
    "Seller confirmed the funds were received. USDT release is now unlocked.",
    "أكّد البائع استلام الأموال. أصبح إرسال USDT متاحًا الآن.",
  ],
  ["Seller started the 45-minute USDT release window.", "بدأ البائع مهلة إرسال USDT ومدتها 45 دقيقة."],
  [
    "Seller marked USDT as sent. Buyer should now confirm receipt.",
    "أكّد البائع إرسال USDT. يجب على المشتري الآن تأكيد الاستلام.",
  ],
  [
    "Buyer confirmed USDT receipt. The trade is complete and has moved to history.",
    "أكّد المشتري استلام USDT. اكتملت الصفقة وانتقلت إلى السجل.",
  ],
  ["Buyer sent a reminder to continue this Trade Room.", "أرسل المشتري تذكيرًا لمتابعة غرفة الصفقة."],
  ["Seller sent a reminder to continue this Trade Room.", "أرسل البائع تذكيرًا لمتابعة غرفة الصفقة."],
] as const;

describe("localizeTradeRoomSystemMessage", () => {
  it("localizes a negotiated price acceptance without losing the exact ILS price", () => {
    const localized = localizeTradeRoomSystemMessage(
      "Seller accepted the price offer of ₪2.95 per USDT. Buyer can now upload the payment receipt.",
      "ar",
    );

    expect(localized.matched).toBe(true);
    expect(localized.text).toContain("₪2.95");
    expect(localized.text).toContain("وافق البائع");
  });

  it.each(currentExactMessages)("localizes the current system message %s", (source, expectedArabic) => {
    const localized = localizeTradeRoomSystemMessage(source, "ar");

    expect(localized).toMatchObject({
      text: expectedArabic,
      dir: "rtl",
      matched: true,
    });
  });

  it.each(currentExactMessages)("preserves current English system copy byte-for-byte for %s", (source) => {
    expect(localizeTradeRoomSystemMessage(source, "en")).toMatchObject({
      text: source,
      dir: "ltr",
      matched: true,
    });
  });

  it("preserves a manual-close reason, explanation, and reference as one isolated value", () => {
    const preserved = "Safety concern. Evidence mismatch for TR-000777 / أحمد.";
    const localized = localizeTradeRoomSystemMessage(
      `Trade was closed manually. Reason: ${preserved}`,
      "ar",
    );

    expect(localized.text).toBe(`تم إغلاق الصفقة يدويًا. السبب: ${preserved}`);
    expect(localized.segments).toContainEqual({ value: preserved, isolate: true });
  });

  it("localizes the current dynamic commission message without changing its amount or token", () => {
    const source = "Commission due was created for the seller (12.34 USDT).";
    const localized = localizeTradeRoomSystemMessage(source, "ar");

    expect(localized.text).toBe("تم إنشاء عمولة مستحقة على البائع بقيمة 12.34 USDT.");
    expect(localized.segments).toContainEqual({ value: "12.34", isolate: true });
    expect(localized.segments).toContainEqual({ value: "USDT", isolate: true });
    expect(localizeTradeRoomSystemMessage(source, "en").text).toBe(source);
  });

  it.each([
    ["Seller declined the trade request.", "رفض البائع طلب الصفقة."],
    ["Buyer cancelled the trade request.", "ألغى المشتري طلب الصفقة."],
    ["Buyer inactivity warning sent.", "تم إرسال تحذير للمشتري بسبب عدم النشاط."],
    ["USDT release window expired — trade marked overdue.", "انتهت مهلة إرسال USDT — تم تصنيف الصفقة كمتأخرة."],
    ["Trade bank details viewed", "تم عرض تفاصيل الحساب البنكي للصفقة."],
    ["Review window unlocked", "أصبح بإمكانك الآن إضافة تقييم."],
    ["Dispute opened for this trade.", "تم فتح نزاع لهذه الصفقة."],
    ["Admin cancelled this trade", "ألغت الإدارة هذه الصفقة."],
  ] as const)("supports persisted decline/cancel/inactivity/bank/review/dispute copy: %s", (source, expectedArabic) => {
    expect(localizeTradeRoomSystemMessage(source, "ar").text).toBe(expectedArabic);
    expect(localizeTradeRoomSystemMessage(source, "en").text).toBe(source);
  });

  it.each([
    [
      "Inactivity warning sent after 30 minutes without buyer progress.",
      "تم إرسال تحذير بسبب عدم إحراز المشتري أي تقدّم لمدة 30 دقيقة.",
      ["30"],
    ],
    [
      "Request request-123 was declined because the listing matched another buyer.",
      "تم رفض الطلب request-123 لأن الإعلان ارتبط بمشترٍ آخر.",
      ["request-123"],
    ],
    [
      "Trade #TR-000777 was cancelled by an admin listing action.",
      "أُلغيت الصفقة #TR-000777 بسبب إجراء إداري على الإعلان.",
      ["#TR-000777"],
    ],
    [
      "Review submitted for trade #TR-000777.",
      "تم إرسال مراجعة للصفقة #TR-000777.",
      ["#TR-000777"],
    ],
    [
      "Dispute opened for trade #TR-000777.",
      "تم فتح نزاع للصفقة #TR-000777.",
      ["#TR-000777"],
    ],
    [
      "Bank details for trade #TR-000777 were viewed.",
      "تم عرض تفاصيل الحساب البنكي للصفقة #TR-000777.",
      ["#TR-000777"],
    ],
    [
      "Seller accepted Lina Ahmad's 1,250.50 USDT request. The trade is now active.",
      "وافق البائع على طلب Lina Ahmad لشراء 1,250.50 USDT. الصفقة نشطة الآن.",
      ["Lina Ahmad", "1,250.50"],
    ],
  ] as const)("preserves dynamic values in %s", (source, expectedArabic, preservedValues) => {
    const localized = localizeTradeRoomSystemMessage(source, "ar");

    expect(localized.text).toBe(expectedArabic);
    for (const value of preservedValues) {
      expect(localized.segments).toContainEqual({ value, isolate: true });
    }
    expect(localizeTradeRoomSystemMessage(source, "en").text).toBe(source);
  });

  it("preserves both legacy English dispute prefixes", () => {
    const messages = [
      "A dispute was opened for trade trade-123.",
      "Dispute opened for trade trade-123.",
    ];

    for (const message of messages) {
      expect(localizeTradeRoomSystemMessage(message, "en").text).toBe(message);
    }
  });

  it("returns unknown text unchanged instead of guessing at user-authored or future copy", () => {
    const source = "Please send this to Sami — ref #A-17 / لا تغيّر هذه الرسالة";
    const localized = localizeTradeRoomSystemMessage(source, "ar");

    expect(localized).toEqual({
      text: source,
      segments: [{ value: source, isolate: true }],
      dir: "auto",
      matched: false,
    });
  });
});
