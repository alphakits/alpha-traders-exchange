import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerTradeHistory, OwnerTradeHistoryPage, type OwnerTradeHistoryData } from "./owner-trade-history";
import { TradeRoomPage } from "./trade-room-page";

const navigation = vi.hoisted(() => ({ search: "view=history", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/account/user-safety-actions", () => ({ UserSafetyActions: () => null }));

function historyRoom(status: OwnerTradeHistoryData["request"]["status"] = "review_open"): OwnerTradeHistoryData {
  return {
    request: {
      id: "request-1", tradeId: "trade-1", buyerId: "buyer-1", sellerId: "seller-1", listingId: "listing-1", buyerName: "Buyer A",
      status, paymentMethod: "Bank Transfer", usdtAmount: "100", fiatAmount: "320", pricePerUsdt: "3.2", currency: "ILS", network: "TRC20",
      createdAt: "2026-09-21T00:00:00.000Z", completedAt: "2026-09-21T00:15:00.000Z", updatedAt: "2026-09-21T00:15:00.000Z",
      timeline: Array.from({ length: 8 }, (_, index) => ({ id: `event-${index}`, type: "request_submitted", actorUserId: "buyer-1", actorRole: "buyer", message: `Recorded event ${index}`, createdAt: `2026-09-21T00:0${index}:00.000Z` })),
      buyerReview: { reviewerUserId: "buyer-1", rating: 5, comment: "Reliable seller", createdAt: "2026-09-21T00:16:00.000Z" },
      sellerBuyerReview: { reviewerUserId: "seller-1", rating: 4, comment: "Prompt buyer", createdAt: "2026-09-21T00:17:00.000Z" },
    },
    counterpart: { buyerName: "Buyer A", sellerName: "Seller B" },
    messages: Array.from({ length: 125 }, (_, index) => ({ id: `message-${index}`, purchaseRequestId: "request-1", kind: "user", senderUserId: index % 2 ? "seller-1" : "buyer-1", senderRole: index % 2 ? "approved_seller" : "buyer", message: `Saved chat ${index}`, createdAt: new Date(Date.UTC(2026, 8, 21, 0, 0, index)).toISOString(), readByUserIds: [] })),
    ownerHistory: {
      evidenceFiles: [{ id: "old-proof", purchaseRequestId: "request-1", side: "buyer", uploadedByUserId: "buyer-1", uploadedAt: "2026-09-21T00:04:00.000Z", fileName: "original-receipt.pdf", mimeType: "application/pdf", sizeBytes: 100, storagePath: "private/storage", status: "replaced" }],
      disputes: [{ id: "dispute-1", tradeId: "trade-1", purchaseRequestId: "request-1", openedByUserId: "buyer-1", buyerId: "buyer-1", sellerId: "seller-1", reason: "Receipt review needed", status: "resolved", resolutionNotes: "Transfer verified", createdAt: "2026-09-21T00:05:00.000Z", updatedAt: "2026-09-21T00:06:00.000Z" }],
      auditLogs: [{ id: "audit-1", action: "purchase_completed", actorUserId: "seller-1", purchaseRequestId: "request-1", details: "Owner audit detail", oldValue: { privateField: "must not stringify" }, createdAt: "2026-09-21T00:15:00.000Z" }],
    },
  };
}

beforeEach(() => {
  navigation.search = "view=history";
  navigation.push.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("owner trade history", () => {
  it.each([
    ["2026-09-23T10:00:00.000Z", "13:00:00"],
    ["2026-01-23T10:00:00.000Z", "12:00:00"],
  ])("uses Israel time, including seasonal clock changes, for %s", (createdAt, expectedTime) => {
    const room = historyRoom();
    room.messages = [{ ...room.messages[0], createdAt }];
    render(<OwnerTradeHistory locale="en" room={room} />);
    const chat = screen.getByRole("region", { name: "Chat history (1)" });
    expect(chat.querySelector("time")?.textContent).toContain(expectedTime);
    expect(screen.getByText("All times are shown in Israel time.")).toBeTruthy();
  });

  it("shows the entire transcript, individual timeline events, historical evidence, reviews and dispute resolution", () => {
    const room = historyRoom();
    room.messages[1].imageUrl = "/api/alpha-exchange/trade-room/request-1/chat-image/message-1";
    room.messages[1].imageName = "chat-photo.jpg";
    render(<OwnerTradeHistory locale="en" room={room} />);
    const chat = screen.getByRole("region", { name: "Chat history (125)" });
    expect(within(chat).getAllByRole("listitem")).toHaveLength(125);
    expect(within(chat).getAllByRole("listitem")[0].textContent).toContain("Saved chat 0");
    expect(within(chat).getAllByRole("listitem")[124].textContent).toContain("Saved chat 124");
    expect(within(chat).getAllByText("Buyer · Buyer A").length).toBeGreaterThan(0);
    expect(within(chat).getAllByText("Seller · Seller B").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("region", { name: "Full trade timeline (8)" })).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "chat-photo.jpg" }).getAttribute("href")).toBe(room.messages[1].imageUrl);
    expect(screen.getByRole("link", { name: "original-receipt.pdf" }).getAttribute("href")).toBe("/api/alpha-exchange/purchase-requests/request-1/evidence/old-proof");
    expect(screen.getByText("Reliable seller")).toBeTruthy();
    expect(screen.getByText("Prompt buyer")).toBeTruthy();
    expect(screen.getByText("Receipt review needed")).toBeTruthy();
    expect(screen.getByText(/Transfer verified/)).toBeTruthy();
    expect(screen.getByText("Owner audit detail")).toBeTruthy();
    expect(screen.queryByText(/must not stringify/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /send|complete|review|cancel/i })).toBeNull();
  });

  it.each(["completed", "review_open", "locked"] as const)("opens %s owner history with only one read and no participant hooks", async (status) => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>().mockImplementation(async () => Response.json(historyRoom(status)));
    const stream = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", stream);
    render(<TradeRoomPage locale="en" requestId="request-1" actor={{ id: "owner-1", role: "owner", fullName: "Owner" }} />);
    await screen.findByText("Owner trade management");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/alpha-exchange/trade-room/request-1?view=history");
    expect(stream).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to purchases" }).getAttribute("href")).toBe("/en/admin/alpha-exchange?section=purchase-requests&requestId=request-1&details=1");
  });

  it("shows a localized error on access failure and permits a clean retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "TRADE_FORBIDDEN" }, { status: 403 })).mockResolvedValueOnce(Response.json(historyRoom()));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="ar" requestId="request-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Saved chat 0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("إدارة الصفقة للمالك");
    expect(screen.getByRole("main").getAttribute("dir")).toBe("rtl");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps unauthorized history requests out of live participant hooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "TRADE_FORBIDDEN" }, { status: 403 }));
    const stream = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", stream);
    render(<TradeRoomPage locale="en" requestId="request-1" actor={{ id: "buyer-1", role: "buyer", fullName: "Buyer" }} />);
    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/alpha-exchange/trade-room/request-1?view=history");
    expect(stream).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved chat 0")).toBeNull();
  });
});


describe("owner history refresh recovery", () => {
  const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it("refreshes complete history, private names and audit without truncating the transcript", async () => {
    vi.useFakeTimers();
    const updated = historyRoom();
    updated.counterpart.buyerName = "AT-123456 (Current private name)";
    updated.ownerHistory!.auditLogs[0].details = "New audit result";
    updated.ownerIdentityLabels = { staff: "AT-654321 (Staff name)" };
    updated.messages.push({ ...updated.messages[0], id: "new-staff-message", senderUserId: "staff", senderRole: "admin", message: "Staff update" });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(historyRoom())).mockResolvedValueOnce(Response.json(updated));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    await advance(8000);
    expect(screen.getByRole("region", { name: "Chat history (126)" })).toBeTruthy();
    expect(screen.getAllByText(/Current private name/).length).toBeGreaterThan(0);
    expect(screen.getByText("AT-654321 (Staff name)")).toBeTruthy();
    expect(screen.getByText("New audit result")).toBeTruthy();
    expect(fetchMock.mock.calls.every(([url, options]) => url.endsWith("?view=history") && !options.method)).toBe(true);
  });

  it.each([401, 403, 404])("clears private history on %s, stops automatic reads, and allows explicit retry", async status => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(historyRoom()))
      .mockResolvedValueOnce({ ok: false, status, json: () => new Promise(() => {}) })
      .mockResolvedValueOnce(Response.json(historyRoom()));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    expect(screen.getByText("Saved chat 0")).toBeTruthy();
    await advance(8000);
    expect(screen.queryByText("Saved chat 0")).toBeNull();
    expect(screen.queryByText("Owner trade management")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("owner access");
    await advance(24000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(screen.getByText("Saved chat 0")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers automatically after a stalled refresh without losing the saved history", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(historyRoom()))
      .mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(Response.json(historyRoom()));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    await advance(23000);
    expect(screen.getByText("Saved chat 0")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("retry");
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    await advance(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pauses offline and refreshes the complete snapshot on reconnect", async () => {
    vi.useFakeTimers();
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(historyRoom()));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    online = false;
    fireEvent(window, new Event("offline"));
    await advance(24000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    online = true;
    fireEvent(window, new Event("online"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved chat 0")).toBeTruthy();
  });

  it("pauses in the background and preserves an unsent owner draft through refresh", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(historyRoom("accepted")));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    fireEvent.change(screen.getByRole("textbox", { name: /Owner message/ }), { target: { value: "Unsent private draft" } });
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    await advance(24000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("textbox", { name: /Owner message/ }) as HTMLTextAreaElement).value).toBe("Unsent private draft");
    expect(fetchMock.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });

  it("ignores an old trade response after navigation and clears the previous private screen", async () => {
    vi.useFakeTimers();
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveOld = resolve; });
    const newRoom = historyRoom();
    newRoom.request.id = "request-2";
    newRoom.messages = [];
    newRoom.counterpart.buyerName = "New trade buyer";
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(historyRoom())).mockReturnValueOnce(pending).mockResolvedValueOnce(Response.json(newRoom));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<OwnerTradeHistoryPage locale="en" requestId="request-1" />);
    await flush();
    await advance(8000);
    view.rerender(<OwnerTradeHistoryPage locale="en" requestId="request-2" />);
    expect(screen.queryByText("Saved chat 0")).toBeNull();
    await flush();
    await act(async () => { resolveOld(Response.json(historyRoom())); });
    expect(screen.getByText("New trade buyer")).toBeTruthy();
    expect(screen.queryByText("Saved chat 0")).toBeNull();
  });
});


describe("owner live chat send recovery", () => {
  it("retains an unconfirmed draft and reuses its reference only on explicit retry", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return Response.json({ message: { id: "saved-owner-message", purchaseRequestId: "request-1", senderRole: "owner", ...body } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    render(<OwnerTradeHistory locale="en" room={historyRoom("accepted")} onUpdated={updated} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Owner message/ }), { target: { value: "Please confirm delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Send as Owner" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("textbox", { name: /Owner message/ }) as HTMLTextAreaElement).value).toBe("Please confirm delivery");
    expect(updated).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send as Owner" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).clientMessageId).toBe(JSON.parse(fetchMock.mock.calls[0][1].body).clientMessageId);
    expect((screen.getByRole("textbox", { name: /Owner message/ }) as HTMLTextAreaElement).value).toBe("");
  });

  it("distinguishes a sent message from a failed history refresh", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => Response.json({ message: { id: "saved-owner-message", purchaseRequestId: "request-1", senderRole: "owner", ...JSON.parse(options.body) } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerTradeHistory locale="en" room={historyRoom("accepted")} onUpdated={() => { throw new Error("Refresh failed"); }} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Owner message/ }), { target: { value: "Please confirm delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Send as Owner" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Message sent, but history could not refresh");
    expect((screen.getByRole("textbox", { name: /Owner message/ }) as HTMLTextAreaElement).value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
