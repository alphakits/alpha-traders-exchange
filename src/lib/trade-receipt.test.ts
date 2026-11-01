import { describe, expect, it } from "vitest";
import { calculateTradePaymentTotal, receiptNotice, tradeReceiptRows } from "@alpha-traders/contracts";
import { buildTradeReceipt } from "./trade-receipt";
import { renderTradeReceipt, tradeReceiptDocument } from "./trade-receipt-render";
import { receiptRequest, receiptCommission } from "@/test-utils/trade-receipt";

describe("private financial trade receipt", () => {
  it("preserves exact final amounts and allocates rounded buyer fees without charging them twice", () => {
    const receipt = buildTradeReceipt(receiptRequest(), receiptCommission, "completion")!;
    expect(receipt).toMatchObject({ usdtAmount: "123.456789", pricePerUsdt: "3.25", baseFiatAmount: "401.23", buyerFeeFiat: "4.02", fiatAmount: "405.25", buyerFeeUsdt: "1.234568", sellerFeeUsdt: "1.234568", totalPlatformFeeUsdt: "2.469136", completedAt: "2026-10-30T11:00:00.000Z" });
    expect(Number(receipt.baseFiatAmount) + Number(receipt.buyerFeeFiat)).toBe(Number(receipt.fiatAmount));
    expect(receiptNotice(receipt, "en")).toContain("do not indicate payment");
  });
  it.each(["ILS", "USD"])("uses saved %s terms, including exact ATM rounding", currency => {
    const request = receiptRequest({ currency, usdtAmount: "1523.229246", fiatAmount: calculateTradePaymentTotal("1523.229246", "3.25", true)! });
    const receipt = buildTradeReceipt(request)!;
    expect(Number(receipt.baseFiatAmount) + Number(receipt.buyerFeeFiat)).toBe(Number(request.fiatAmount));
    expect(tradeReceiptRows(receipt, "en").find(([label]) => label === "Recorded payment total to seller")?.[1]).toContain(currency);
  });
  it("does not invent fees from another trade or replace historical timestamps with update time", () => {
    const receipt = buildTradeReceipt(receiptRequest({ completedAt: undefined }), { ...receiptCommission, purchaseRequestId: "other" })!;
    expect(receipt.completedAt).toBeNull();
    expect(receipt.totalPlatformFeeUsdt).toBeNull();
    expect(receipt.source).toBe("historical_record");
  });
  it("shows an unreconciled legacy total without inventing an itemization", () => {
    const receipt = buildTradeReceipt(receiptRequest({ fiatAmount: "500.00" }))!;
    expect(receipt).toMatchObject({ fiatAmount: "500.00", baseFiatAmount: null, buyerFeeFiat: null });
  });
  it("retains pre-cutover seller-only fees", () => {
    const receipt = buildTradeReceipt(receiptRequest({ feePolicyVersion: undefined, fiatAmount: "401.23" }), { ...receiptCommission, buyerFeeCollectedAmount: undefined, sellerFeeAmount: undefined, commissionAmount: 1.23 })!;
    expect(receipt).toMatchObject({ buyerFeeFiat: "0.00", buyerFeeUsdt: "0", sellerFeeUsdt: "1.23", totalPlatformFeeUsdt: "1.23" });
  });
  it("recovers floating-point cents on old records without rounding a materially different saved total", () => {
    const values = { usdtAmount: "0.1", pricePerUsdt: "3.2", feePolicyVersion: undefined };
    expect(buildTradeReceipt(receiptRequest({ ...values, fiatAmount: "0.32000000000000006" }))?.fiatAmount).toBe("0.32");
    expect(buildTradeReceipt(receiptRequest({ ...values, fiatAmount: "0.321234567" }))?.fiatAmount).toBe("0.321234567");
  });
  it.each(["pending", "cancelled", "declined", "usdt_sent"] as const)("does not issue a receipt for %s", status => {
    expect(buildTradeReceipt(receiptRequest({ status }))).toBeUndefined();
  });
  it("excludes names, contact details, payment credentials, wallets and free-text notes in both languages", () => {
    const receipt = buildTradeReceipt(receiptRequest(), receiptCommission)!;
    const output = [JSON.stringify(receipt), renderTradeReceipt(receipt, "en").text, tradeReceiptDocument(receipt, "ar")].join(" ");
    for (const secret of ["PRIVATE", "+972500000123", "123456789", "buyerWhatsapp", "actorUserId"]) expect(output).not.toContain(secret);
    expect(receipt.buyerPublicId).toMatch(/^AT-/);
  });
  it("escapes document values and embeds no scripts or external requests", () => {
    const receipt = buildTradeReceipt(receiptRequest({ tradeId: "<script>alert(1)</script>", displayNumber: undefined }))!;
    const html = tradeReceiptDocument(receipt, "en");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script|<iframe|<img|https?:\/\//);
  });
});
