import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { tradeChatStatus } from "@alpha-traders/contracts";
import type { TradeChatMessage } from "@/types/alpha-exchange";
import { TradeChatMessageLabel, TradeChatMessageStatus } from "./trade-chat-message-label";

const context = { request: { buyerId: "buyer-1", sellerId: "seller-1" }, counterpart: {
  buyerName: "Private Buyer +972500000000", sellerName: "Private Seller",
  buyerPublicId: "#S-100001", sellerPublicId: "#S-200002",
} };
const message: TradeChatMessage = { id: "message-1", purchaseRequestId: "trade-1", kind: "user", senderUserId: "buyer-1", senderRole: "approved_seller", message: "Hello", createdAt: "2026-09-24T12:00:00Z", readByUserIds: ["buyer-1"] };

describe("public trade chat labels", () => {
  it("shows the verified owner with a red Owner badge", () => {
    const html = renderToStaticMarkup(<TradeChatMessageLabel message={{ ...message, senderUserId: "owner-1", senderRole: "owner" }} context={context} actorId="buyer-1" locale="en" />);
    expect(html).toContain("Owner");
    expect(html).toContain("bg-red-600/25");
    expect(html).not.toContain("Support");
  });
  it("shows the dashboard AT ID and actual trade side, including a seller who is buying", () => {
    const html = renderToStaticMarkup(<TradeChatMessageLabel message={message} context={context} actorId="buyer-1" locale="en" />);
    expect(html).toContain("AT-100001");
    expect(html).toContain("Buyer");
    expect(html).toContain("You");
    expect(html).not.toContain("Private");
    expect(html).not.toContain("972500000000");
    expect(html).not.toContain(">Seller<");
  });
  it("never uses a real name from an older cached snapshot as an identity or initial", () => {
    const html = renderToStaticMarkup(<TradeChatMessageLabel message={{ ...message, senderUserId: "seller-1" }} context={{ ...context, counterpart: { sellerName: "Private Seller +972500000000" } }} actorId="buyer-1" locale="ar" />);
    expect(html).toMatch(/AT-\d{6}/);
    expect(html).toContain("البائع");
    expect(html).not.toMatch(/Private|972500000000/);
  });
  it("identifies system and support messages without attributing them to the other participant", () => {
    const system = { ...message, kind: "system" as const };
    expect(renderToStaticMarkup(<TradeChatMessageLabel message={system} context={context} actorId="buyer-1" locale="en" />)).toContain("Trade update");
    expect(renderToStaticMarkup(<TradeChatMessageStatus message={system} parties={context.request} locale="en" />)).toBe("");
    expect(renderToStaticMarkup(<TradeChatMessageLabel message={{ ...message, senderUserId: "admin" }} context={context} actorId="buyer-1" locale="en" />)).toContain("Support");
  });
  it("shows Seen only for the actual recipient, not an owner read or a legacy timestamp", () => {
    expect(tradeChatStatus({ ...message, readByUserIds: ["buyer-1", "owner"], seenAt: "2026-09-24T12:01:00Z" } as TradeChatMessage, context.request)).toBe("sent");
    expect(tradeChatStatus({ ...message, readByUserIds: ["buyer-1", "seller-1"] }, context.request)).toBe("seen");
    expect(tradeChatStatus({ ...message, id: "optimistic-msg-test", sentAt: message.createdAt } as TradeChatMessage, context.request)).toBe("sending");
    expect(tradeChatStatus({ ...message, deliveredAt: message.createdAt }, context.request)).toBe("delivered");
    expect(renderToStaticMarkup(<TradeChatMessageStatus message={{ ...message, readByUserIds: ["buyer-1", "seller-1"] }} parties={context.request} locale="ar" />)).toContain("تمت القراءة");
  });
});
