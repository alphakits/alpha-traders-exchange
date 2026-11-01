import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TradeReceiptPanel } from "./trade-receipt-panel";
import { CompletedTradeHistory } from "./completed-trade-history";
import { buildTradeReceipt } from "@/lib/trade-receipt";
import { receiptRequest, receiptCommission } from "@/test-utils/trade-receipt";
import type { TradeChatMessage } from "@/types/alpha-exchange";
afterEach(cleanup);
it.each(["en", "ar"] as const)("shows exact receipt figures and authenticated download paths in %s", locale => {
  const receipt = buildTradeReceipt(receiptRequest(), receiptCommission)!;
  render(<TradeReceiptPanel receipt={receipt} requestId="receipt-trade" locale={locale} />);
  expect(screen.getByText("123.456789 USDT")).toBeTruthy();
  expect(screen.getByText("405.25 ILS").closest("dd")?.classList.contains("currency-money")).toBe(true);
  const link = screen.getByRole("link", { name: locale === "ar" ? "تنزيل الإيصال" : "Download receipt" });
  expect(link.getAttribute("href")).toBe(`/api/alpha-exchange/purchase-requests/receipt-trade/receipt?format=html&locale=${locale}&download=1`);
  expect(document.body.textContent).not.toContain("PRIVATE");
});
it("keeps saved timeline and conversation available after completion while hiding credentials", () => {
  const request = receiptRequest();
  const messages = [
    { id: "one", kind: "user", senderUserId: request.sellerId, senderRole: "approved_seller", message: "Transfer confirmed", createdAt: request.completedAt },
    { id: "two", kind: "user", senderUserId: request.buyerId, senderRole: "buyer", message: "SECRET WITHDRAWAL 123456", credentialKind: "cardless_code", createdAt: request.createdAt },
  ] as TradeChatMessage[];
  render(<CompletedTradeHistory request={request} messages={messages} locale="en" />);
  expect(screen.getByText("Full trade timeline")).toBeTruthy();
  expect(screen.getByText("Transfer confirmed")).toBeTruthy();
  expect(screen.getByText("Protected withdrawal details were shared during the trade.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("SECRET WITHDRAWAL");
  expect(document.body.textContent).not.toContain("PRIVATE NOTE");
});
