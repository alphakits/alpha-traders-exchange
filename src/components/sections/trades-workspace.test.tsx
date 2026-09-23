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
    expect(regions[0].textContent).toContain("new-request");
    expect(regions[1].textContent).toContain("finished");
    expect(screen.queryByText("other")).toBeNull();
    expect(within(regions[0]).getByRole("link").getAttribute("href")).toBe("/trade-room/new-request?action=open-trade#status-banner");
    expect(within(regions[1]).getByRole("link").getAttribute("href")).toContain("action=review-trade");
  });
  it("opens seller requests at the accept step and keeps sales separate from purchases", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ requests: [request("incoming", "pending"), { ...request("my-purchase", "pending", "seller"), sellerId: "another-seller" }] }))));
    render(<TradesWorkspace userId="seller" sellerAccess locale="en" />);
    await screen.findByText("incoming");
    expect(screen.getByRole("link", { name: "Review request" }).getAttribute("href")).toBe("/trade-room/incoming?action=accept-trade#action-required");
    expect(screen.queryByText("my-purchase")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "My purchases" }));
    expect(screen.getByText("my-purchase")).toBeTruthy();
    expect(screen.queryByText("incoming")).toBeNull();
  });
  it("preserves trade history when a refresh fails and recovers without logging the user out", async () => {
    const payload = () => new Response(JSON.stringify({ requests: [request("my-request", "pending")] }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(payload()).mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(payload()));
    render(<TradesWorkspace userId="buyer" sellerAccess={false} locale="en" />);
    await screen.findByText("my-request");
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not refresh"));
    expect(screen.getByText("my-request")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh trades" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
