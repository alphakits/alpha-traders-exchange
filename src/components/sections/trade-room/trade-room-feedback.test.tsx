import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ push: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.search }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: navigation.push }) }));
vi.mock("@/components/account/user-safety-actions", () => ({ UserSafetyActions: () => null }));
import { TradeRoomPage } from "./trade-room-page";
import type { PurchaseRequest } from "@/types/alpha-exchange";

function room(paymentMethod: string, status: PurchaseRequest["status"]) {
  return {
    request: { id: "feedback-request", tradeId: "feedback-trade", buyerId: "feedback-buyer", sellerId: "feedback-seller", status,
      paymentMethod, usdtAmount: "100", fiatAmount: "320", network: "TRC20", currency: "ILS", buyerWalletAddress: "",
      createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z", timeline: [], messages: [],
    },
    listing: null, counterpart: { buyerName: "Buyer", sellerName: "Seller" }, messages: [],
    poke: { available: false, canPoke: false, cooldownUntil: null, cooldownRemainingSeconds: 0, counterpartRole: "buyer" },
    deadlineAt: null, releaseDeadlineActive: false, sellerCommissionDueCount: 0, sellerCommissionDueAmount: 0, hasOpenDispute: false, canOpenDispute: false,
  };
}
const seller = { id: "feedback-seller", role: "approved_seller" as const, fullName: "Seller" };
const buyer = { id: "feedback-buyer", role: "buyer" as const, fullName: "Buyer" };
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

class RoomStream extends EventTarget {
  static instances: RoomStream[] = [];
  close = vi.fn();
  constructor() { super(); RoomStream.instances.push(this); }
  snapshot(value: ReturnType<typeof room>) {
    this.dispatchEvent(new MessageEvent("trade-room", { data: JSON.stringify(value) }));
  }
}

beforeEach(() => {
  window.sessionStorage.clear();
  navigation.push.mockReset();
  RoomStream.instances = [];
  vi.stubGlobal("EventSource", RoomStream);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s action feedback", (method) => {
  it("keeps the confirmed stage while saving, rejects double taps, then shows the next action beside success", async () => {
    let current = room(method, "payment_sent");
    const response = deferredResponse();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const label = method === "Bank Transfer" ? "Confirm Money Received" : method === "Cardless ATM Withdrawal" ? "I Collected the ATM Cash" : "I Received the Cash";
    const button = await screen.findByRole("button", { name: label });
    expect(screen.getAllByRole("button", { name: label })).toHaveLength(1);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect((screen.getByRole("button", { name: "Processing..." }) as HTMLButtonElement).disabled).toBe(true);
    current = { ...current, request: { ...current.request, status: "funds_received", updatedAt: "2026-09-22T00:00:01.000Z" } };
    await act(async () => response.resolve(Response.json({ request: current.request })));
    const action = await screen.findByRole("button", { name: method === "Bank Transfer" ? "Release USDT" : "Confirm USDT Sent" });
    const card = document.getElementById("action-required")!;
    expect(card.contains(action)).toBe(true);
    expect(card.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByTestId("trade-progress-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector("button")).toBe(action);
    expect(within(card).getByTestId("trade-action-feedback")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(navigation.push).not.toHaveBeenCalled();
    // A later counterparty confirmation must replace the earlier success label.
    current = { ...current, request: { ...current.request, status: "review_open", updatedAt: "2026-09-22T00:00:05.000Z" } };
    await act(async () => RoomStream.instances.at(-1)!.snapshot(current));
    expect(await screen.findByText("🎉 Trade Completed Successfully")).toBeTruthy();
    expect(screen.queryByTestId("trade-action-feedback")).toBeNull();
  });

  it("keeps the original stage and offers retry after a failed action", async () => {
    const current = room(method, "pending");
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH"
      ? Response.json({ error: "Temporarily unavailable" }, { status: 503 }) : Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept Trade" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Temporarily unavailable");
    expect(document.getElementById("action-required")!.contains(error)).toBe(true);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect((screen.getByRole("button", { name: "Accept Trade" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s live recovery", (method) => {
  it("renews a planned stream connection without repeating a trade action", async () => {
    vi.useFakeTimers();
    const current = room(method, "accepted");
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />); });
    const old = RoomStream.instances[0];
    await act(async () => old.snapshot(current));
    await act(async () => {
      old.dispatchEvent(new MessageEvent("reconnect", { data: "{}" }));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(old.close).toHaveBeenCalled();
    expect(RoomStream.instances).toHaveLength(2);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => RoomStream.instances[1].snapshot(current));
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("replaces a suspended stream and refreshes on return without a reload or a repeated mutation", async () => {
    let current = room(method, "accepted");
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    await screen.findByRole("progressbar");
    const oldStream = RoomStream.instances[0];
    await act(async () => oldStream.snapshot(current));
    expect(screen.getByText("Connected")).toBeTruthy();
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(oldStream.close).toHaveBeenCalled();
    expect(screen.queryByText("Connected")).toBeNull();
    const previous = current;
    current = { ...current, request: { ...current.request, status: "payment_sent", updatedAt: "2026-09-22T00:00:01.000Z" } };
    const calls = fetchMock.mock.calls.length;
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    const label = method === "Bank Transfer" ? "Confirm Money Received" : method === "Cardless ATM Withdrawal" ? "I Collected the ATM Cash" : "I Received the Cash";
    expect(await screen.findByRole("button", { name: label })).toBeTruthy();
    expect(fetchMock.mock.calls.length - calls).toBe(1);
    expect(RoomStream.instances).toHaveLength(2);
    await act(async () => oldStream.snapshot(previous));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    // Opening a socket is not itself evidence that its snapshot is current.
    await act(async () => RoomStream.instances[1].dispatchEvent(new Event("open")));
    expect(screen.queryByText("Connected")).toBeNull();
    await act(async () => RoomStream.instances[1].snapshot(current));
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("recovers a silent connected stream, without polling a hidden page", async () => {
    vi.useFakeTimers();
    let current = room(method, "accepted");
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />); });
    await act(async () => RoomStream.instances[0].snapshot(current));
    current = { ...current, request: { ...current.request, status: "payment_sent", updatedAt: "2026-09-22T00:00:02.000Z" } };
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    const calls = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock.mock.calls).toHaveLength(calls);
  });
});

describe("bank evidence feedback", () => {
  it("waits for the upload acknowledgement without blocking on a later room refresh", async () => {
    const current = room("Bank Transfer", "accepted");
    const response = deferredResponse();
    let reads = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/evidence")) return response.promise;
      return ++reads === 1 ? Promise.resolve(Response.json(current)) : new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    const input = await screen.findByLabelText("Choose payment receipt");
    expect(document.getElementById("action-required")!.contains(input)).toBe(true);
    fireEvent.change(input, { target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Payment Receipt" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/evidence"))).toBe(true));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
    expect(screen.queryByRole("link", { name: "receipt.png" })).toBeNull();
    await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "payment_sent", updatedAt: "2026-09-22T00:00:01.000Z", buyerEvidence: { id: "receipt-1", fileName: "receipt.png" } } })));
    expect(await screen.findByText("Payment receipt uploaded and seller notified.")).toBeTruthy();
    expect(screen.queryByText("Uploading...")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  });

  it("keeps the selected receipt available after an upload failure", async () => {
    const current = room("Bank Transfer", "accepted");
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith("/evidence") ? Response.json({ error: "Upload failed" }, { status: 503 }) : Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    fireEvent.change(await screen.findByLabelText("Choose payment receipt"), { target: { files: [new File(["receipt"], "retry.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Payment Receipt" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Upload failed");
    expect(screen.getByText("retry.png")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload Payment Receipt" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
  });
});

it("places required buyer feedback before completion details", async () => {
  const current = room("Face-to-Face (Meet in Person)", "review_open");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  const submit = await screen.findByRole("button", { name: "Submit Rating" });
  const details = screen.getByText("The Face-to-Face trade has been recorded as complete.");
  expect(submit.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each(["en", "ar"] as const)("puts pending terms decisions first in %s", async (locale) => {
  const base = room("Cardless ATM Withdrawal", "accepted");
  const current = { ...base, request: { ...base.request, termsProposal: { id: "terms-1", kind: "counter_offer", status: "pending", usdtAmount: "100", fiatAmount: "310", pricePerUsdt: "3.10", createdAt: base.request.updatedAt } } };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
  const accept = await screen.findByRole("button", { name: locale === "ar" ? "موافقة على الشروط" : "Accept these terms" });
  expect(document.getElementById("action-required")!.querySelector("button")).toBe(accept);
  expect(screen.queryByTestId("trade-primary-action")).toBeNull();
  expect(screen.queryByText("No required action at this moment.")).toBeNull();
});

it("keeps copy and reminder feedback beside the chat controls", async () => {
  const current = room("Face-to-Face (Meet in Person)", "accepted");
  current.poke.available = true;
  current.poke.canPoke = true;
  current.poke.counterpartRole = "seller";
  vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText: vi.fn().mockResolvedValue(undefined) } } }));
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(Response.json(url.endsWith("/poke") ? { poke: current.poke } : current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  fireEvent.click(await screen.findByRole("button", { name: "Poke Seller" }));
  const chat = document.getElementById("chat")!;
  expect(chat.contains(await screen.findByText("Seller notified."))).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "Meeting at the agreed location" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(chat.contains(await screen.findByText("Message copied."))).toBe(true);
  expect(screen.queryByTestId("trade-action-feedback")).toBeNull();
});

describe("visible buyer cancellation", () => {
  it.each(["en", "ar"] as const)("places pending cardless cancellation above details and submits once in %s", async (locale) => {
    const current = room("Cardless ATM Withdrawal", "pending");
    const response = deferredResponse();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
    const cancel = await screen.findByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel Trade" });
    const card = screen.getByTestId("trade-cancel-action");
    expect(document.getElementById("action-required")!.contains(card)).toBe(true);
    expect(card.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ status: "cancelled" });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "cancelled" } })));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/usdt-exchange"));
  });

  it("allows leaving an accepted cardless request before code submission", async () => {
    const current = room("Cardless ATM Withdrawal", "accepted");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    const cancel = await screen.findByRole("button", { name: "Cancel Trade" });
    const code = screen.getByLabelText("1. Withdrawal code");
    expect(cancel.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cancel);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each(["payment_sent", "funds_received", "usdt_sent", "review_open", "cancelled"] as const)("does not offer unsafe cancellation at %s", async (status) => {
    const current = room("Cardless ATM Withdrawal", status);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    await screen.findByTestId("trade-details");
    if (status === "review_open" || status === "cancelled") expect(screen.queryByTestId("trade-cancel-action")).toBeNull();
    else expect((screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s management controls", (method) => {
  it.each(["en", "ar"] as const)("shows buyer cancellation and explains seller-only adjustment near the top in %s", async (locale) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, "pending")))));
    render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
    const cancel = await screen.findByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel Trade" });
    const adjust = screen.getByRole("button", { name: locale === "ar" ? "تعديل المبلغ" : "Adjust Amount" });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    expect((adjust as HTMLButtonElement).disabled).toBe(true);
    expect(adjust.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById("action-required")!.contains(adjust)).toBe(true);
  });

  it("cancels a seller's pending request through the existing decline action", async () => {
    const current = room(method, "pending");
    const fetch = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH" ? Response.json({ request: { ...current.request, status: "declined" } }) : Response.json(current)));
    vi.stubGlobal("fetch", fetch);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const cancel = await screen.findByRole("button", { name: "Cancel Trade" });
    expect(cancel.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cancel);
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    const patch = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ status: "declined" });
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it("opens the seller amount editor before payment details after acceptance", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, "accepted")))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const adjust = await screen.findByRole("button", { name: "Adjust Amount" });
    expect((adjust as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(adjust);
    const amount = screen.getByLabelText("Correct USDT amount");
    expect(amount.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Either participant can cancel before/)).toBeTruthy();
  });

  it.each(["en", "ar"] as const)("lets the accepted seller cancel once before payment in %s", async (locale) => {
    const current = room(method, "accepted");
    const response = deferredResponse();
    const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetch);
    render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={seller} />);
    const cancel = await screen.findByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel Trade" });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById("action-required")!.contains(cancel)).toBe(true);
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    const patches = fetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ status: "cancelled" });
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "cancelled" } })));
    expect(navigation.push).toHaveBeenCalledWith("/usdt-exchange");
  });

  it("keeps the seller in the room if cancellation loses a race with payment", async () => {
    const current = room(method, "accepted");
    const fetch = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH"
      ? Response.json({ error: "Payment has already started. Refresh the trade." }, { status: 409 }) : Response.json(current)));
    vi.stubGlobal("fetch", fetch);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel Trade" }));
    expect(await screen.findByText("Payment has already started. Refresh the trade.")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)("locks seller cancellation at %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, status)))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const cancel = await screen.findByRole("button", { name: "Cancel Trade" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
  });
});

it("requires the seller's confirmation before cancelling", async () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(Response.json(room("Bank Transfer", "accepted"))));
  vi.stubGlobal("fetch", fetch);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Trade" }));
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  expect(navigation.push).not.toHaveBeenCalled();
});

it.each([
  { request: { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-09-22T12:00:00Z" } },
  { request: { buyerEvidence: { id: "buyer-proof" } } },
  { hasOpenDispute: true },
])("locks seller cancellation when the accepted status has hidden progress or a dispute: %j", async (overrides) => {
  const base = room("Cardless ATM Withdrawal", "accepted");
  const current = { ...base, ...overrides, request: { ...base.request, ...overrides.request } };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  expect((await screen.findByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the recorded cardless cash fixed and recalculates only once", async () => {
  const base = room("Cardless ATM Withdrawal", "payment_sent");
  const current = { ...base, request: { ...base.request, fiatAmount: "400.00", pricePerUsdt: "3.20" } };
  const response = deferredResponse();
  const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetch);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Adjust Amount" }));
  const cash = screen.getByLabelText("Bank withdrawal amount (ILS)") as HTMLInputElement;
  expect(cash.value).toBe("400.00");
  expect(cash.readOnly).toBe(true);
  const adjust = screen.getByRole("button", { name: "Adjust USDT to withdrawal amount" });
  fireEvent.click(adjust);
  fireEvent.click(adjust);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  await act(async () => response.resolve(Response.json({ request: { ...current.request, usdtAmount: "125" } })));
  expect(await screen.findByText("Amount confirmed: 125 USDT for ILS 400.00.")).toBeTruthy();
});
