import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
import { UsdtRequestsWorkspace } from "./usdt-requests-workspace";
import type { DemandView, DemandWorkspace } from "@/types/usdt-demand";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "", session: { user: { id: "buyer" } } as { user: { id: string } | null } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => mocks.session }));
const base: DemandWorkspace = { actorId: "buyer", canRespond: false, reference: { price: "3.30", minimum: "2.95", maximum: "3.65" }, requests: [], listings: [], nextCursor: null };
function demand(): DemandView {
  return { id: "demand-one", requesterName: "AT-100", amount: calculateCardlessUsdtAmount("1000", "3.30", true)!, price: "3.30", network: "TRC20", paymentMethod: "Cardless ATM Withdrawal", city: "", revision: 1, state: "open", isMine: true, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), updatedAt: new Date().toISOString(), offers: [] };
}
beforeEach(() => { vi.clearAllMocks(); mocks.query = ""; mocks.session = { user: { id: "buyer" } }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("USDT request workspace", () => {
  it("shows canonical public identities in buyer cards, seller responses and final review", async () => {
    const requester = { accountId: "AT-123456", displayName: "AT-123456", profileHref: "/u/seller-buyer", approvedSeller: false, sellerRank: null, completedPurchases: 12, buyerProgress: { rank: "bronze" as const, nextRank: "silver" as const, progressPercent: 0 } };
    const seller = { accountId: "AT-654321", displayName: "AT-654321", profileHref: "/u/seller-approved", approvedSeller: true, sellerRank: "gold" as const, completedPurchases: null, buyerProgress: null };
    const row: DemandView = { ...demand(), requester, paymentMethod: "Bank Transfer", amount: "5000", offers: [{ id: "offer-one", listingId: "listing-one", price: "3.30", state: "open", revision: 1, sellerName: seller.displayName, seller, isMine: false, available: true }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, requests: [row] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    await screen.findByText("AT-123456");
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View profile: AT-123456/ }).getAttribute("href")).toBe("/u/seller-buyer");
    expect(screen.getByRole("link", { name: /View profile: AT-654321/ }).getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Review response" }));
    expect(screen.getAllByText("AT-654321")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /View profile: AT-654321/ })).toHaveLength(2);
    expect(screen.getAllByTestId("request-counterparty-identity")).toHaveLength(3);
  });
  it("opens the seller feed from its menu URL and preserves the chosen view in navigation", async () => {
    mocks.query = "scope=available";
    mocks.session = { user: { id: "seller" } };
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ ...base, actorId: "seller", canRespond: true }));
    vi.stubGlobal("fetch", fetcher);
    render(<UsdtRequestsWorkspace locale="en" actorId="seller" />);
    expect((await screen.findByRole("button", { name: "Buyer requests · Sell USDT" })).getAttribute("aria-pressed")).toBe("true");
    expect(fetcher.mock.calls[0][0]).toContain("scope=available");
    fireEvent.click(screen.getByRole("button", { name: "My buying requests" }));
    expect(mocks.replace).toHaveBeenCalledWith("/usdt-exchange/requests?scope=mine", { scroll: false });
    await screen.findByRole("button", { name: "Create a request" });
  });
  it("returns a buyer with a seller-feed URL to their own requests", async () => {
    mocks.query = "scope=available";
    const fetcher = vi.fn(async (url: string) => Response.json({ ...base, requests: url.includes("scope=mine") ? [demand()] : [] }));
    vi.stubGlobal("fetch", fetcher);
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    await screen.findByText("AT-100");
    expect(mocks.replace).toHaveBeenCalledWith("/usdt-exchange/requests?scope=mine", { scroll: false });
    expect(screen.getByRole("button", { name: "My buying requests" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps seller back navigation in the buyer-request feed", async () => {
    mocks.session = { user: { id: "seller" } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, actorId: "seller", canRespond: true, requests: [{ ...demand(), isMine: false }] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="seller" demandId="demand-one" />);
    await screen.findByText("AT-100");
    expect(screen.getByRole("link", { name: "Back to requests" }).getAttribute("href")).toBe("/usdt-exchange/requests?scope=available");
  });
  it("blocks price actions after refresh failure and recovers without losing the buyer draft", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failed) throw new TypeError("Failed to fetch");
      return Response.json(base);
    }));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a request" }));
    fireEvent.change(screen.getByLabelText("Amount (USDT)"), { target: { value: "5,000" } });
    expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(false);
    failed = true; fireEvent.focus(window);
    await screen.findByText(/We could not refresh the latest price/);
    expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(true);
    failed = false; fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Amount (USDT)") as HTMLInputElement).value).toBe("5,000");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows a useful recovery message for a non-JSON server failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Unavailable</html>", { status: 503 })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Please refresh and try again");
    expect(screen.queryByRole("button", { name: "Create a request" })).toBeNull();
  });
  it("stops using a quote at its provider expiry without waiting for the next poll", async () => {
    let time = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, reference: { ...base.reference!, validUntil: new Date(time + 500).toISOString() } })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a request" }));
    fireEvent.change(screen.getByLabelText("Amount (USDT)"), { target: { value: "5,000" } });
    expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(false);
    time += 1000;
    await waitFor(() => expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(true), { timeout: 2000 });
    expect(screen.getByText("Waiting for a fresh quote")).toBeTruthy();
  });
  it("clears old account data when an API refresh reports a different signed-in account", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let actor = "buyer";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, actorId: actor, requests: [demand()] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    await screen.findByText("AT-100");
    actor = "different-account"; fireEvent.focus(window);
    expect((await screen.findByRole("alert")).textContent).toContain("session changed");
    expect(screen.queryByText("AT-100")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update / renew" })).toBeNull();
  });
  it("blocks opening a trade at request expiry before the next server poll", async () => {
    let time = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    const latest: DemandView = { ...demand(), expiresAt: new Date(time + 500).toISOString(), paymentMethod: "Bank Transfer", amount: "5000",
      offers: [{ id: "offer-one", listingId: "listing-one", price: "3.30", state: "open", revision: 1, sellerName: "AT-200", isMine: false, available: true }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, requests: [latest] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Review response" }));
    fireEvent.change(screen.getByLabelText(/Your receiving wallet/), { target: { value: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Open Trade Room" }) as HTMLButtonElement).disabled).toBe(false);
    time += 1000;
    await waitFor(() => expect((screen.getByRole("button", { name: "Open Trade Room" }) as HTMLButtonElement).disabled).toBe(true), { timeout: 2000 });
  });
  it("keeps the ATM cash value selected when renewing a request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...base, requests: [demand()] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Update / renew" }));
    expect((screen.getByLabelText("ATM cash total incl. 1% fee (ILS)") as HTMLSelectElement).value).toBe("1000");
  });
  it("requires a fresh quote before publishing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...base, reference: null })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a request" }));
    expect((screen.getByRole("button", { name: "Publish request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Waiting for a fresh quote")).toBeTruthy();
  });
  it("hides private request data when the signed-in account changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ ...base, requests: [demand()] })));
    const view = render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Update / renew" }));
    mocks.session = { user: { id: "different-account" } };
    view.rerender(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    expect(screen.getByRole("alert").textContent).toContain("session changed");
    expect(screen.queryByText("AT-100")).toBeNull();
    mocks.session = { user: { id: "buyer" } };
    view.rerender(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    await screen.findByRole("button", { name: "Update / renew" });
    expect(screen.queryByRole("button", { name: "Publish request" })).toBeNull();
  });
  it("displays load failures without enabling publication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Your account needs verification." }, { status: 403 })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("needs verification"));
    expect(screen.queryByRole("button", { name: "Create a request" })).toBeNull();
  });
  it("blocks a stale editor until the buyer explicitly reloads the latest details", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let latest: DemandView = { ...demand(), paymentMethod: "Bank Transfer", amount: "1000" };
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "PATCH"
      ? Response.json({ error: "This request changed. Refresh before trying again." }, { status: 409 })
      : Response.json({ ...base, requests: [latest] }));
    vi.stubGlobal("fetch", fetcher);
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Update / renew" }));
    latest = { ...latest, revision: 2, state: "cancelled", amount: "2000" };
    fireEvent.focus(window);
    await screen.findByRole("heading", { name: /2,000 USDT/ });
    expect((screen.getByLabelText("Amount (USDT)") as HTMLInputElement).value).toBe("1,000");
    expect((screen.getByRole("button", { name: "Save and renew" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Request details" }));
    expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reload latest details" }));
    expect((screen.getByLabelText("Amount (USDT)") as HTMLInputElement).value).toBe("2,000");
  });
  it("clears the editor on navigation and starts a fresh revision after a successful renewal", async () => {
    let second = { ...demand(), id: "demand-two", requesterName: "AT-200", revision: 7 };
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") { second = { ...second, revision: second.revision + 1 }; return Response.json({ ok: true }); }
      return Response.json({ ...base, requests: [url.endsWith("demand-two") ? second : demand()] });
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Update / renew" }));
    view.rerender(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-two" />);
    await screen.findByText("AT-200");
    expect(screen.queryByRole("button", { name: "Save and renew" })).toBeNull();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Update / renew" }));
      fireEvent.submit(screen.getByRole("button", { name: "Save and renew" }).closest("form")!);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Save and renew" })).toBeNull());
      await waitFor(() => expect((screen.getByRole("button", { name: "Update / renew" }) as HTMLButtonElement).disabled).toBe(false));
    }
    const mutations = fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(mutations.map(([url]) => url)).toEqual(Array(2).fill("/api/alpha-exchange/usdt-requests/demand-two"));
    expect(mutations.map(([, options]) => JSON.parse(String(options?.body)).revision)).toEqual([7, 8]);
  });
  it("requires a new seller selection when the buyer changes the request revision", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    mocks.session = { user: { id: "seller" } };
    let latest: DemandView = { ...demand(), isMine: false, paymentMethod: "Bank Transfer", amount: "1000" };
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST" ? Response.json({ id: "offer-new" })
      : Response.json({ ...base, actorId: "seller", canRespond: true, requests: [latest], listings: [{ id: "listing-one", price: "3.30", amount: "10000" }] }));
    vi.stubGlobal("fetch", fetcher);
    render(<UsdtRequestsWorkspace locale="en" actorId="seller" demandId="demand-one" />);
    const listing = await screen.findByLabelText("Your listing") as HTMLSelectElement;
    fireEvent.change(listing, { target: { value: "listing-one" } });
    fireEvent.change(screen.getByLabelText("Your response price (ILS)"), { target: { value: "3.25" } });
    latest = { ...latest, revision: 2, amount: "2000" }; fireEvent.focus(window);
    await screen.findByRole("heading", { name: /2,000 USDT/ });
    await waitFor(() => expect(listing.value).toBe(""));
    expect((screen.getByLabelText("Your response price (ILS)") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Send response" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    fireEvent.change(listing, { target: { value: "listing-one" } });
    fireEvent.change(screen.getByLabelText("Your response price (ILS)"), { target: { value: "3.20" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send response" }).closest("form")!);
    await screen.findByText("Your response was sent.");
    const mutation = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(String(mutation[1]?.body))).toMatchObject({ listingId: "listing-one", price: "3.20", revision: 2 });
    expect(listing.value).toBe("");
  });
  it("keeps loaded history on refresh and removes duplicate cursor rows", async () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({ ...demand(), id: "row-" + index, state: "cancelled" as const }));
    const fetcher = vi.fn(async (url: string) => Response.json({
      ...base, requests: url.includes("cursor=") ? rows.slice(29) : rows.slice(0, 30), nextCursor: url.includes("cursor=") ? null : "next-page",
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("request-card")).toHaveLength(31));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(screen.getAllByTestId("request-card")).toHaveLength(31);
  });
  it("hides the entire workspace when pagination reports an account change", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("cursor=")
      ? { ...base, actorId: "another-account" }
      : { ...base, requests: Array.from({ length: 30 }, (_, index) => ({ ...demand(), id: "row-" + index })), nextCursor: "next-page" })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect((await screen.findByRole("alert")).textContent).toContain("session changed");
    expect(screen.queryByText("AT-100")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
  it("guides a cancelled trade back to renewal while retaining its previous trade link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, requests: [{ ...demand(), state: "trade_cancelled", purchaseRequestId: "old-trade" }] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    expect(await screen.findByRole("heading", { name: "This request is closed" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View previous Trade Room" }).getAttribute("href")).toBe("/trade-room/old-trade");
    expect(screen.getByRole("button", { name: "Update / renew" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Continue in your Trade Room" })).toBeNull();
  });
  it("does not tell a seller to edit a paused buyer request", async () => {
    mocks.session = { user: { id: "seller" } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, actorId: "seller", canRespond: true, requests: [{ ...demand(), isMine: false, state: "paused" }] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="seller" demandId="demand-one" />);
    expect(await screen.findByText(/Refresh later or browse other open requests/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update / renew" })).toBeNull();
  });
  it("ignores a completed submission after the account context changes", async () => {
    let finish: (response: Response) => void = () => {};
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST" ? pending : Response.json(base));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create a request" }));
    fireEvent.change(screen.getByLabelText("Amount (USDT)"), { target: { value: "5,000" } });
    fireEvent.submit(screen.getByRole("form", { name: "Request details" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    mocks.session = { user: { id: "another-account" } };
    view.rerender(<UsdtRequestsWorkspace locale="en" actorId="buyer" />);
    await act(async () => { finish(Response.json({ destination: "/usdt-exchange/requests/new" })); await pending; });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("session changed");
  });
  it("closes the trade review and clears wallet details when its response becomes unavailable", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let latest: DemandView = {
      ...demand(), paymentMethod: "Bank Transfer", amount: "5000",
      offers: [{ id: "offer-one", listingId: "listing-one", price: "3.30", state: "open", revision: 1, sellerName: "AT-200", isMine: false, available: true }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...base, requests: [latest] })));
    render(<UsdtRequestsWorkspace locale="en" actorId="buyer" demandId="demand-one" />);
    fireEvent.click(await screen.findByRole("button", { name: "Review response" }));
    fireEvent.change(screen.getByLabelText(/Your receiving wallet/), { target: { value: "private-draft-wallet" } });
    latest = { ...latest, offers: latest.offers.map(offer => ({ ...offer, available: false })) };
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("form", { name: "Trade review" })).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("no longer available");
    latest = { ...latest, offers: latest.offers.map(offer => ({ ...offer, available: true })) };
    fireEvent.focus(window);
    fireEvent.click(await screen.findByRole("button", { name: "Review response" }));
    expect((screen.getByLabelText(/Your receiving wallet/) as HTMLInputElement).value).toBe("");
  });
});
