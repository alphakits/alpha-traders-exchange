import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => null }));
import { TradeRequestGroups, TradesWorkspace } from "./trades-workspace";
const request = (id: string, status: PurchaseRequest["status"], buyerId = "buyer") => ({ id, tradeId: id, status, buyerId, sellerId: "seller", buyerName: "Buyer", usdtAmount: "1500", paymentMethod: "Face-to-Face", createdAt: "2026-09-23T09:00:00Z", updatedAt: "2026-09-23T09:00:00Z" } as PurchaseRequest);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Trades workspace", () => {
  it.each(["en", "ar"] as const)("renders pending requests before completed history with correct next-action links (%s)", locale => {
    render(<TradeRequestGroups requests={[request("finished", "completed"), request("new-request", "pending"), request("other", "pending", "someone-else")]} userId="buyer" side="buyer" locale={locale} />);
    const regions = screen.getAllByRole("region");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(within(regions[0]).getByRole("link").getAttribute("href")).toBe("/trade-room/new-request?action=open-trade#status-banner");
    expect(within(regions[1]).getByRole("link").getAttribute("href")).toContain("action=review-trade");
    // Server and browser must show Israel time regardless of their default zone.
    expect(regions[0].querySelector("time")?.textContent).toContain("12:00");
    expect(regions[0].querySelector("time")?.getAttribute("datetime")).toBe("2026-09-23T09:00:00.000Z");
  });
  it("opens seller requests at the accept step and keeps sales separate from purchases", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ requests: [request("incoming", "pending"), { ...request("my-purchase", "pending", "seller"), sellerId: "another-seller" }] }))));
    render(<TradesWorkspace userId="seller" sellerAccess locale="en" />);
    await screen.findByRole("link", { name: "Review request" });
    expect(screen.getByRole("link", { name: "Review request" }).getAttribute("href")).toBe("/trade-room/incoming?action=accept-trade#action-required");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "My purchases" }));
    expect(screen.getByRole("link", { name: "Open trade" }).getAttribute("href")).toBe("/trade-room/my-purchase?action=open-trade#status-banner");
    expect(screen.queryByRole("link", { name: "Review request" })).toBeNull();
  });
  it("preserves trade history when a refresh fails and recovers without logging the user out", async () => {
    const payload = () => new Response(JSON.stringify({ requests: [request("my-request", "pending")] }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(payload()).mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(payload()));
    render(<TradesWorkspace userId="buyer" sellerAccess={false} locale="en" />);
    await screen.findByRole("link", { name: "Open trade" });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not refresh"));
    expect(screen.getByRole("link", { name: "Open trade" }).getAttribute("href")).toBe("/trade-room/my-request?action=open-trade#status-banner");
    fireEvent.click(screen.getByRole("button", { name: "Refresh trades" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
  it.each(["en", "ar"] as const)("renders recorded legacy amounts and the public trade reference (%s)", locale => {
    const legacy = { ...request("purchase-legacy", "review_open"), tradeId: "trade-internal-id", displayNumber: 73, usdtAmount: "75,000" };
    render(<TradeRequestGroups requests={[legacy]} userId="seller" side="seller" locale={locale} />);
    const card = screen.getByRole("article");
    expect(card.textContent).toContain("75,000");
    expect(card.textContent).toContain("#TR-000073");
    expect(card.textContent).not.toContain("trade-internal-id");
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/trade-room/purchase-legacy?action=review-trade#status-banner");
  });
  it.each([["1,234.567891", "1,234.567891"], ["0.000001", "0.000001"], ["", "—"], ["12,34", "—"], ["invalid", "—"]])("preserves amount precision and rejects malformed saved values (%s)", (amount, expected) => {
    render(<TradeRequestGroups requests={[{ ...request("amount", "completed"), usdtAmount: amount }]} userId="buyer" side="buyer" locale="en" />);
    expect(screen.getByRole("article").textContent).toContain(expected);
  });
});
