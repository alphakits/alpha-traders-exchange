// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { moneyColors } from "@alpha-traders/design-tokens";
import { buildAdminAnnouncementEmail, composeAdminAnnouncementEmailContent } from "@/lib/admin-announcement-email";
import { buildMarketplaceEmail } from "@/lib/marketplace-email-delivery";
import { buildTradeReceipt } from "@/lib/trade-receipt";
import { brandedTradeReceiptEmail, tradeReceiptDocument } from "@/lib/trade-receipt-render";
import { receiptRequest } from "@/test-utils/trade-receipt";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const colored = (root: ParentNode, color: string) => Array.from(root.querySelectorAll<HTMLElement>("[style]"))
  .filter(element => element.getAttribute("style")?.includes(`color:${color}`))
  .map(element => element.textContent);

describe("monetary text in mail and printed receipts", () => {
  it.each(["en", "ar"] as const)("renders exact sums in green on the %s email and paper receipt", locale => {
    const receipt = Object.freeze(buildTradeReceipt(receiptRequest({
      id: "trade-987654", displayNumber: 987654, usdtAmount: "12345.678900", pricePerUsdt: "1000.00", fiatAmount: "12345678.90",
    }), undefined, "completion")!);
    const actionUrl = "https://example.test/trade-room/trade-987654#trade-receipt";
    const email = brandedTradeReceiptEmail(receipt, locale, actionUrl);
    for (const [html, color] of [[email.html, moneyColors.onDark], [tradeReceiptDocument(receipt, locale), moneyColors.onLight]]) {
      const doc = parse(html);
      const money = colored(doc, color);
      expect(money).toContain("12,345.678900 USDT");
      expect(money).toContain("12,345,678.90 ILS");
      expect(money).toContain("1,000.00 ILS");
      expect(money).toContain(locale === "ar" ? "كمية USDT" : "USDT amount");
      expect(money).toContain(locale === "ar" ? "السعر لكل USDT" : "Price per USDT");
      expect(money.join(" ")).not.toMatch(/987654|2026|UTC|TRC20/);
      expect(doc.body.textContent).toContain("#987654");
      expect(doc.body.textContent).not.toContain("#987,654");
    }
    expect(email.text).toContain("12,345.678900 USDT");
    expect(parse(email.html).querySelector("a")?.getAttribute("href")).toBe(actionUrl);
    expect(receipt.usdtAmount).toBe("12345.678900");
  });

  it("escapes transactional money text and keeps the action path intact", () => {
    const en = "Amount: $12000.00 <test>";
    const ar = "المبلغ: 12000.00 USDT";
    const payload = buildMarketplaceEmail({
      event: "trade_accepted", recipientName: "Trader", message: { en, ar }, title: { en: "Amount", ar: "المبلغ" },
      actionLabel: { en: "View amount", ar: "عرض المبلغ" }, actionPath: "/trade-room/request-12345", referenceLabel: "#12345",
    });
    const doc = parse(payload.html);
    const greenCopy = colored(doc, moneyColors.onDark).join(" ");
    expect(greenCopy).toContain("$12,000.00");
    expect(greenCopy).toContain("12,000.00 USDT");
    expect(colored(doc, moneyColors.onGold).some(text => /amount/i.test(text || ""))).toBe(true);
    expect(doc.querySelector("test")).toBeNull();
    expect(doc.body.textContent).toContain("<test>");
    expect(doc.querySelector("a")?.getAttribute("href")).toMatch(/\/ar\/trade-room\/request-12345$/);
    expect(payload.text).toContain("#12345");
  });

  it("formats announcement labels and rich-text money without altering a URL", () => {
    const url = "https://example.test/orders/12345?source=a_b_c";
    const message = buildAdminAnnouncementEmail(composeAdminAnnouncementEmailContent({
      ar: { subject: "تحديث", title: "المبلغ", content: `**15000 USDT**\n[المبلغ](${url})`, ctaText: "عرض المبلغ" },
      en: { subject: "Update", title: "Amount", content: `**$15000.00**\n[Amount](${url})`, ctaText: "View amount" },
      ctaUrl: url,
    }));
    const doc = parse(message.html);
    expect(colored(doc, moneyColors.onDark)).toEqual(expect.arrayContaining(["15,000 USDT", "$15,000.00"]));
    expect(Array.from(doc.querySelectorAll("a[href]")).some(el => el.getAttribute("href") === url)).toBe(true);
    expect(message.text).toContain(`Amount (${url})`);
    expect(message.text).toContain("$15,000.00");
  });
});
