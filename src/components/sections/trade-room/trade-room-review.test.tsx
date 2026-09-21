import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ push: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.search }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/account/user-safety-actions", () => ({ UserSafetyActions: () => null }));
import { TradeRoomPage } from "./trade-room-page";
import { CanonicalSessionProvider, useCanonicalSession } from "@/components/auth/canonical-session-provider";
import type { ClientSessionUser } from "@/lib/client-session-user";

const room = {
  request: { id: "request-1", tradeId: "trade-1", buyerId: "buyer-1", sellerId: "seller-1", status: "review_open",
    paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "100", fiatAmount: "320", network: "TRC20", currency: "ILS",
    completedAt: "2026-09-21T00:00:00.000Z", createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z",
    timeline: [], messages: [],
  },
  listing: null, counterpart: { buyerName: "Buyer", sellerName: "Seller" }, messages: [],
  poke: { available: false, canPoke: false, cooldownUntil: null, cooldownRemainingSeconds: 0, counterpartRole: "seller" },
  sellerCommissionDueCount: 0, sellerCommissionDueAmount: 0, hasOpenDispute: false, canOpenDispute: false,
};
const saved = { review: { id: "review-request-1", tradeId: "trade-1", buyerId: "buyer-1", sellerId: "seller-1",
  rating: 5, comment: "Done", createdAt: "2026-09-21T00:00:01.000Z", updatedAt: "2026-09-21T00:00:01.000Z" } };

beforeEach(() => {
  mocks.push.mockClear();
  window.sessionStorage.clear();
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("completed trade review UI", () => {
  it("keeps the completed trade and written review visible when session recovery fails", async () => {
    const seller: ClientSessionUser = {
      id: "seller-1", fullName: "Seller", email: "seller@example.test", role: "approved_seller", sellerStatus: "approved_seller",
      whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "online", createdAt: "2026-01-01",
    };
    let sessionReads = 0;
    const fetchMock = vi.fn((url: string) => Promise.resolve(url === "/api/auth/me"
      ? ++sessionReads === 1 ? Response.json({ user: seller }) : Response.json({ error: "unavailable" }, { status: 503 })
      : Response.json(room)));
    vi.stubGlobal("fetch", fetchMock);
    function SessionCheck() {
      const { refresh, user, error } = useCanonicalSession();
      return <><output>{user ? error ? "Reconnecting" : "Signed in" : "Login"}</output>
        <button onClick={() => void refresh({ background: true })}>Check connection</button></>;
    }
    render(<CanonicalSessionProvider initialSessionUser={seller}>
      <SessionCheck />
      <TradeRoomPage locale="en" requestId="request-1" actor={{ id: "seller-1", role: "approved_seller", fullName: "Seller" }} />
    </CanonicalSessionProvider>);
    await screen.findByRole("button", { name: "Return home" });
    fireEvent.click(screen.getByText("Review buyer"));
    fireEvent.change(screen.getByLabelText("Buyer feedback"), { target: { value: "Review stays here" } });
    await act(async () => { fireEvent.click(screen.getByText("Check connection")); });
    expect(screen.getByText("Reconnecting")).toBeTruthy();
    expect(screen.queryByText("Login")).toBeNull();
    expect((screen.getByLabelText("Buyer feedback") as HTMLTextAreaElement).value).toBe("Review stays here");
    expect(screen.getByRole("button", { name: "Return home" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/trade-room/"))).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("leaves the review form and returns to the market even when subsequent room reads never finish", async () => {
    let roomReads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.endsWith("/review")) return Promise.resolve(Response.json(saved));
      if (url.includes("/trade-room/")) return ++roomReads === 1 ? Promise.resolve(Response.json(room)) : new Promise(() => {});
      return Promise.resolve(Response.json({ notifications: [] }));
    }));
    render(<TradeRoomPage locale="en" requestId="request-1" actor={{ id: "buyer-1", role: "buyer", fullName: "Buyer" }} />);
    fireEvent.change(await screen.findByPlaceholderText("Share your seller feedback..."), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Submit Rating" })).toBeNull());
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/usdt-exchange"), { timeout: 3500 });
    expect(roomReads).toBe(1);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/notifications"))).toBe(false);
  });

  it("lets the seller review the buyer or return home without redirecting completed trades", async () => {
    const sellerReview = { reviewerUserId: "seller-1", rating: 5, comment: "Prompt buyer", createdAt: "2026-09-21T00:00:02.000Z" };
    const fetchMock = vi.fn((url: string) => Promise.resolve(Response.json(url.endsWith("/review") ? { sellerBuyerReview: sellerReview } : room)));
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeRoomPage locale="en" requestId="request-1" actor={{ id: "seller-1", role: "approved_seller", fullName: "Seller" }} />);
    const home = await screen.findByRole("button", { name: "Return home" });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Review buyer"));
    fireEvent.change(screen.getByLabelText("Buyer feedback"), { target: { value: "Prompt buyer" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit buyer review" }));
    await screen.findByText(/Your buyer review is saved/);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/trade-room/"))).toHaveLength(1);
    fireEvent.click(home);
    expect(mocks.push).toHaveBeenCalledWith("/usdt-exchange");
  });

  it("keeps the written feedback and re-enables submission after a database failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith("/review")
      ? Response.json({ error: "Query read timeout" }, { status: 503 })
      : Response.json(room))));
    render(<TradeRoomPage locale="en" requestId="request-1" actor={{ id: "buyer-1", role: "buyer", fullName: "Buyer" }} />);
    const comment = await screen.findByPlaceholderText("Share your seller feedback...") as HTMLTextAreaElement;
    fireEvent.change(comment, { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Rating" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Submit Rating" }) as HTMLButtonElement).disabled).toBe(false));
    expect(comment.value).toBe("Done");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
