import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ path: "/dashboard" }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => navigation.path, Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { TradeHeaderNotice } from "./trade-header-notice";
import { publishTradeHeaderActivity, type TradeHeaderActivity } from "@/lib/trade-header-activity";
afterEach(cleanup);

describe("cached layout trade notice", () => {
  it("updates waiting and completed notices without refreshing the layout or fetching auth", () => {
    navigation.path = "/dashboard";
    const trade: TradeHeaderActivity = { id: "request-header", tradeId: "trade-header", buyerId: "header-buyer", sellerId: "header-seller", paymentMethod: "Bank Transfer", status: "accepted", updatedAt: "2026-09-22T01:00:00Z", buyerReviewed: false };
    render(<TradeHeaderNotice locale="en" actorId={trade.buyerId} initialTrade={trade} counterpartyName="Seller" />);
    expect(screen.getByText("Action required")).toBeTruthy();
    act(() => publishTradeHeaderActivity(trade.buyerId, { ...trade, status: "payment_sent", updatedAt: "2026-09-22T01:00:01Z" }));
    expect(screen.queryByText("Action required")).toBeNull();
    expect(screen.getByText("Resume Trade")).toBeTruthy();
    act(() => publishTradeHeaderActivity(trade.buyerId, { ...trade, status: "review_open", buyerReviewed: true, updatedAt: "2026-09-22T01:00:02Z" }));
    expect(screen.queryByTestId("trade-header-notice")).toBeNull();
  });

  it("does not duplicate the room's own guidance, including Arabic routes", () => {
    navigation.path = "/ar/trade-room/own-room";
    const trade: TradeHeaderActivity = { id: "own-room", buyerId: "own-buyer", sellerId: "own-seller", paymentMethod: "Bank Transfer", status: "accepted", updatedAt: "2026-09-22T02:00:00Z", buyerReviewed: false };
    render(<TradeHeaderNotice locale="ar" actorId={trade.buyerId} initialTrade={trade} counterpartyName="Seller" />);
    expect(screen.queryByTestId("trade-header-notice")).toBeNull();
  });
});
