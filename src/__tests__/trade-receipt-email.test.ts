import { afterEach, expect, it, vi } from "vitest";
import { buildTradeReceipt } from "@/lib/trade-receipt";
import { receiptRequest, receiptCommission } from "@/test-utils/trade-receipt";
const queue = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, queued: true }));
vi.mock("@/lib/marketplace-email-outbox", () => ({ enqueueMarketplaceEmail: queue, runMarketplaceEmailSweep: vi.fn() }));
import { sendMarketplaceEmail } from "@/lib/marketplace-email-delivery";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each(["en", "ar"] as const)("queues a separate %s receipt body and printable attachment, with no credentials", async locale => {
  vi.stubEnv("RESEND_API_KEY", "synthetic-key"); vi.stubEnv("EMAIL_FROM", "Alpha <noreply@example.test>");
  const receipt = buildTradeReceipt(receiptRequest(), receiptCommission, "completion")!;
  await sendMarketplaceEmail({ event: "trade_completed", to: "buyer@example.test", recipientId: "buyer", recipientName: "Buyer", recipientLocale: locale,
    title: { en: "Trade completed", ar: "اكتملت الصفقة" }, message: { en: "Your receipt", ar: "إيصالك" },
    actionLabel: { en: "View receipt", ar: "عرض الإيصال" }, actionPath: "/trade-room/receipt-trade#trade-receipt",
    completionReceipt: receipt, idempotencyKey: "trade-lifecycle:receipt-trade:trade_completed:buyer",
  });
  expect(queue).toHaveBeenCalledOnce();
  const prepared = queue.mock.calls[0][0];
  expect(prepared).toMatchObject({ requestId: "receipt-trade", recipientId: "buyer", requiredTradeStatuses: ["completed", "review_open", "locked"] });
  const body = JSON.parse(prepared.body);
  expect(body.to).toEqual(["buyer@example.test"]); expect(body.cc).toBeUndefined(); expect(body.bcc).toBeUndefined();
  expect(body.html).toContain('src="cid:alpha-traders-logo"');
  expect(body.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ content_id: "alpha-traders-logo" })]));
  expect(body.html).toContain("405.25 ILS"); expect(body.text).toContain("405.25 ILS");
  const attachment = body.attachments.find((item: { filename: string }) => item.filename.endsWith(".html"));
  const html = Buffer.from(attachment.content, "base64").toString("utf8");
  expect(html).toContain(`lang="${locale}"`); expect(html).toContain("123.456789 USDT");
  expect(html).not.toContain("PRIVATE"); expect(html).not.toContain("buyer@example.test");
});
it("refuses to queue one trade's financial receipt under a different trade or recipient key", async () => {
  vi.stubEnv("RESEND_API_KEY", "synthetic-key"); vi.stubEnv("EMAIL_FROM", "Alpha <noreply@example.test>");
  const localized = { en: "Test", ar: "اختبار" };
  const payload = { event: "trade_completed" as const, to: "buyer@example.test", recipientId: "buyer", recipientName: "Buyer", recipientLocale: "en" as const,
    title: localized, message: localized, actionLabel: localized, actionPath: "/trade-room/receipt-trade#trade-receipt",
    completionReceipt: buildTradeReceipt(receiptRequest(), receiptCommission, "completion")!,
    idempotencyKey: "trade-lifecycle:receipt-trade:trade_completed:buyer" };
  await expect(sendMarketplaceEmail({ ...payload, actionPath: "/trade-room/other-trade#trade-receipt" })).resolves.toMatchObject({ ok: false });
  await expect(sendMarketplaceEmail({ ...payload, recipientId: "different-account" })).resolves.toMatchObject({ ok: false });
  expect(queue).not.toHaveBeenCalled();
});
