import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ push: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.search }));
vi.mock("@/i18n/navigation", () => ({ Link: () => null, useRouter: () => ({ push: navigation.push }) }));
vi.mock("@/components/account/user-safety-actions", () => ({ UserSafetyActions: () => null }));
import { TradeRoomPage } from "./trade-room-page";
import { readTradeRoomCache, writeTradeRoomCache } from "@/lib/trade-room-client";
import { cancelPageSectionNavigation, revealPageSection } from "@/lib/page-section-navigation";
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

async function answerActionDialog(confirm = true) {
  const dialog = screen.getByRole("dialog");
  const message = within(dialog).getByRole("heading").textContent;
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: confirm ? /^(Confirm|تأكيد)$/ : /^(Cancel|إلغاء)$/ }));
  });
  return message;
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
  navigation.search = new URLSearchParams();
  window.history.replaceState(null, "", "/");
  navigation.push.mockReset();
  RoomStream.instances = [];
  vi.stubGlobal("EventSource", RoomStream);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  // Embedded browsers may suppress native confirmations. Every financial
  // action below must use the visible in-page confirmation instead.
  vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("Native dialogs are unavailable"); });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); cancelPageSectionNavigation(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ["upload-payment-receipt", "accepted", buyer],
  ["upload-seller-evidence", "usdt_release_pending", seller],
] as const)("keeps the current action focused when shared navigation restores a legacy %s link", async (action, status, actor) => {
  vi.useFakeTimers();
  navigation.search = new URLSearchParams(`action=${action}`);
  window.history.replaceState(null, "", `/en/trade-room/feedback-request?action=${action}#evidence`);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room("Bank Transfer", status)))));
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={actor} />); });
  // The shared hash restorer can run before the room's queued focus frame.
  act(() => { revealPageSection("evidence"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
  expect(document.activeElement?.id).toBe("action-required");
});

it("waits for the canonical room when a hash restorer starts before the room mounts", async () => {
  vi.useFakeTimers();
  navigation.search = new URLSearchParams("action=upload-payment-receipt");
  window.history.replaceState(null, "", "/en/trade-room/feedback-request?action=upload-payment-receipt#evidence");
  revealPageSection("evidence");
  writeTradeRoomCache("feedback-request", buyer.id, room("Bank Transfer", "pending"));
  const response = deferredResponse();
  vi.stubGlobal("fetch", vi.fn(() => response.promise));
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(document.activeElement).toBe(document.body);
  await act(async () => response.resolve(Response.json(room("Bank Transfer", "accepted"))));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
  expect(document.activeElement?.id).toBe("action-required");
});

it("honors repeated explicit chat navigation and yields to newer typing", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room("Bank Transfer", "accepted")))));
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(32); });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    act(() => { document.getElementById("action-required")!.focus(); revealPageSection("chat"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(document.activeElement?.id).toBe("chat");
  }
  act(() => { revealPageSection("action-required"); });
  const draft = screen.getByPlaceholderText("Type a message...");
  act(() => { draft.focus(); fireEvent.change(draft, { target: { value: "Keep my draft" } }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
  expect(document.activeElement).toBe(draft);
  expect((draft as HTMLTextAreaElement).value).toBe("Keep my draft");
});

it.each([
  ["en", "listing_price", "Bank Leumi"],
  ["en", "buyer_offer", "Bank Leumi"],
  ["ar", "listing_price", "بنك لئومي"],
  ["ar", "buyer_offer", "بنك لئومي"],
] as const)("shows the withdrawal bank in the room summary before accepting a %s %s request", async (locale, priceMode, bank) => {
  const current = room("Cardless ATM Withdrawal", "pending");
  Object.assign(current.request, { bankName: "Bank Leumi", priceMode, pricePerUsdt: "3.20", listingPriceAtRequest: "3.40" });
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={seller} />);
  const summary = await screen.findByTestId("trade-room-summary");
  const bankValue = within(summary).getByText(bank, { exact: true });
  expect(bankValue.parentElement?.textContent).toContain(locale === "ar" ? "بنك السحب" : "Withdrawal bank");
  expect(bankValue.closest("details")).toBeNull();
  const primary = await screen.findByTestId("trade-primary-action");
  expect(bankValue.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect((within(primary).getAllByRole("button")[0] as HTMLButtonElement).disabled).toBe(false);
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it.each(["en", "ar"] as const)("gates seller acceptance and links payment, then unlocks the saved request after a verified refresh in %s", async (locale) => {
  const current = { ...room("Bank Transfer", "pending"), sellerCommissionDueCount: 1, sellerCommissionDueAmount: 7, sellerPayableCommissionId: "commission-gate", sellerPayableCommissionAmount: 7 };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={seller} />);
  const primary = await screen.findByTestId("trade-primary-action");
  const accept = within(primary).getAllByRole("button")[0] as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  expect(within(primary).getByText(locale === "ar" ? /سدّد جميع العمولات/ : /Pay all outstanding commission/).className).toContain("commission-notice");
  fireEvent.click(within(primary).getByRole("button", { name: locale === "ar" ? "دفع العمولة" : "Pay Commission" }));
  expect(navigation.push).toHaveBeenCalledWith("/usdt-exchange?commission=pay&commissionId=commission-gate#commission-payment");
  const cleared = { ...current, sellerCommissionDueCount: 0, sellerCommissionDueAmount: 0 };
  await act(async () => { RoomStream.instances[0]!.snapshot(cleared); });
  await waitFor(() => expect((within(primary).getAllByRole("button")[0] as HTMLButtonElement).disabled).toBe(false));
  expect(within(primary).queryByRole("button", { name: locale === "ar" ? "دفع العمولة" : "Pay Commission" })).toBeNull();
});

it("keeps a pending buyer room free of the seller's private commission controls", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room("Bank Transfer", "pending")))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  await screen.findByText(/Current Status/);
  expect(screen.queryByRole("button", { name: "Pay Commission" })).toBeNull();
  expect(screen.queryByText(/Pay all outstanding commission/)).toBeNull();
});

it.each(["en", "ar"] as const)("accepts an ATM trade in %s with native dialogs unavailable, explicit consent, and no duplicate request", async (locale) => {
  const initial = room("Cardless ATM Withdrawal", "pending");
  const current = { ...initial, request: { ...initial.request, feePolicyVersion: "buyer_seller_1pct_v1", usdtAmount: "327.059733", fiatAmount: "1100.00", pricePerUsdt: "3.33" } };
  const response = deferredResponse();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={seller} />);
  const accept = await screen.findByRole("button", { name: locale === "ar" ? "قبول الطلب" : "Accept Trade" });
  const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(patches()).toHaveLength(0);
  await answerActionDialog(false);
  expect(patches()).toHaveLength(0);
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(accept);
  fireEvent.click(accept);
  await answerActionDialog();
  fireEvent.click(accept);
  expect(patches()).toHaveLength(1);
  expect(JSON.parse(String(patches()[0][1]?.body))).toMatchObject({ status: "accepted" });
  expect(window.confirm).not.toHaveBeenCalled();
  await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "accepted", updatedAt: "2026-09-22T00:00:02.000Z" } })));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
  expect(screen.queryByRole("button", { name: locale === "ar" ? "قبول الطلب" : "Accept Trade" })).toBeNull();
});

it("requires both terms and safe-meeting consent before accepting face-to-face with native dialogs unavailable", async () => {
  const current = room("Face-to-Face (Meet in Person)", "pending");
  const response = deferredResponse();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  const accept = await screen.findByRole("button", { name: "Accept Trade" });
  fireEvent.click(accept);
  await answerActionDialog();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  expect(await answerActionDialog(false)).toContain("safe public place");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  fireEvent.click(accept);
  await answerActionDialog();
  expect(await answerActionDialog()).toContain("safe public place");
  const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({ status: "accepted", safetyAcknowledged: true });
  expect(window.confirm).not.toHaveBeenCalled();
  await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "accepted", updatedAt: "2026-09-22T00:00:02.000Z" } })));
});

it("requires fresh consent if live terms change while the acceptance dialog is open", async () => {
  let current = room("Cardless ATM Withdrawal", "pending");
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept Trade" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  current = { ...current, request: { ...current.request, fiatAmount: "400.00", usdtAmount: "125", updatedAt: "2026-09-22T00:00:02.000Z" } };
  await act(async () => RoomStream.instances.at(-1)!.snapshot(current));
  await answerActionDialog();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  expect(await screen.findByText("The trade changed while you were confirming. Review its current details and try again.")).toBeTruthy();
});

it.each(["completed", "review_open", "locked"] as const)("keeps a %s notification focused on its review target after a completed-state refresh", async (status) => {
  navigation.search = new URLSearchParams("action=review-trade");
  window.history.replaceState(null, "", "/?action=review-trade#status-banner");
  writeTradeRoomCache("feedback-request", buyer.id, room("Face-to-Face (Meet in Person)", "payment_sent"));
  const response = deferredResponse();
  vi.stubGlobal("fetch", vi.fn(() => response.promise));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  await act(async () => response.resolve(Response.json(room("Face-to-Face (Meet in Person)", "completed"))));
  await waitFor(() => expect(document.activeElement?.id).toBe("status-banner"));
  const refreshed = room("Face-to-Face (Meet in Person)", status);
  refreshed.request.updatedAt = "2026-09-22T00:00:01.000Z";
  await act(async () => { RoomStream.instances[0]!.snapshot(refreshed); });
  await waitFor(() => expect(readTradeRoomCache<ReturnType<typeof room>>("feedback-request", buyer.id)?.request.status).toBe(status));
  expect(await screen.findByRole("heading", { name: "Trade Completed Successfully" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement?.id).toBe("status-banner"));
});

it.each(["fetch", "body"])("confirms a committed trade action after a stalled %s without sending it twice", async (phase) => {
  vi.useFakeTimers();
  let current = room("Bank Transfer", "pending");
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      current = { ...current, request: { ...current.request, status: "accepted", updatedAt: "2026-09-22T00:00:01.000Z" } };
      return phase === "fetch" ? new Promise<Response>(() => {})
        : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response);
    }
    return Promise.resolve(Response.json(current));
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />); });
  fireEvent.click(screen.getByRole("button", { name: "Accept Trade" }));
  await answerActionDialog();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
  expect(screen.queryByRole("button", { name: "Processing..." })).toBeNull();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});

it.each([
  ["cancel", "fetch"], ["cancel", "body"], ["adjust", "fetch"], ["adjust", "body"], ["poke", "fetch"], ["poke", "body"],
] as const)("releases %s after a stalled %s without repeating the action or accepting a late response", async (action, phase) => {
  vi.useFakeTimers();
  const current = room("Cardless ATM Withdrawal", action === "adjust" ? "pending" : "accepted");
  current.poke.available = true; current.poke.canPoke = true; current.poke.counterpartRole = "seller";
  Object.assign(current.request, { fiatAmount: "400.00", pricePerUsdt: "3.20" });
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "POST" || init?.method === "PATCH"
    ? phase === "fetch" ? pending : Promise.resolve({ ok: true, json: () => pending })
    : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={action === "poke" ? buyer : seller} />); });
  if (action === "adjust") {
    fireEvent.click(screen.getByRole("button", { name: "Adjust Amount" }));
    fireEvent.change(screen.getByLabelText("New withdrawal amount (ILS)"), { target: { value: "200" } });
  }
  const label = action === "cancel" ? "Cancel Trade" : action === "adjust" ? "Propose corrected amount" : "Poke Seller";
  const button = screen.getByRole("button", { name: label });
  fireEvent.click(button); fireEvent.click(button);
  if (action === "cancel") await answerActionDialog();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PATCH")).toHaveLength(1);
  const payload = { request: { ...current.request, status: "cancelled" }, poke: current.poke };
  await act(async () => { finish(phase === "fetch" ? Response.json(payload) : payload); });
  expect(navigation.push).not.toHaveBeenCalled();
  expect(screen.queryByText("Seller notified.")).toBeNull();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(action === "adjust" ? "0" : "20");
});

it.each([["dispute", "fetch"], ["dispute", "body"], ["close", "fetch"], ["close", "body"]] as const)("keeps the %s draft and unlocks the room after a stalled %s", async (action, phase) => {
  vi.useFakeTimers();
  const current = room("Bank Transfer", action === "close" ? "pending" : "accepted");
  current.canOpenDispute = true;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "POST" || init?.method === "PATCH"
    ? phase === "fetch" ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
    : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />); });
  fireEvent.click(screen.getByRole("button", { name: action === "close" ? "Close Trade" : "Open Dispute" }));
  const draft = screen.getByLabelText(action === "close" ? "Trade close reason" : "Dispute reason") as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "Please check the recorded trade status." } });
  const label = action === "close" ? "Confirm Manual Close" : "Submit Dispute";
  fireEvent.click(screen.getByRole("button", { name: label }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false);
  expect(draft.value).toBe("Please check the recorded trade status.");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PATCH")).toHaveLength(1);
  expect(screen.queryByText(action === "close" ? "Trade closed manually." : "Dispute opened and admins were notified.")).toBeNull();
});

it("does not leave a trade when cancellation returns an unconfirmed success body", async () => {
  const current = room("Bank Transfer", "accepted");
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(Response.json(init?.method === "PATCH" ? {} : current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Trade" }));
  await answerActionDialog();
  await screen.findByText("Cancellation could not be confirmed. Check the trade status before trying again.");
  expect(navigation.push).not.toHaveBeenCalled();
});

it.each(["fetch", "body"])("retains the payment receipt after a stalled upload %s and ignores late confirmation", async (phase) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const current = room("Bank Transfer", "accepted");
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const fetchMock = vi.fn((url: string) => url.endsWith("/evidence")
    ? phase === "fetch" ? pending : Promise.resolve({ ok: true, json: () => pending })
    : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  fireEvent.change(await screen.findByLabelText("Choose payment receipt"), { target: { files: [new File(["proof"], "recover-receipt.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload Payment Receipt" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/evidence"))).toBe(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect((screen.getByRole("button", { name: "Upload Payment Receipt" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText("recover-receipt.png")).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/evidence"))).toHaveLength(1);
  const payload = { request: { ...current.request, status: "payment_sent" } };
  await act(async () => { finish(phase === "fetch" ? Response.json(payload) : payload); });
  expect(screen.queryByText("Payment receipt uploaded and seller notified.")).toBeNull();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
});

it.each(["missing", "wrong-message"])("keeps the draft and same message ID when a successful response has a %s acknowledgement", async (kind) => {
  const current = room("Bank Transfer", "accepted");
  const bodies: Array<{ message: string; clientMessageId: string }> = [];
  let confirm = false;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/messages") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      if (!confirm) return Promise.resolve(Response.json(kind === "missing" ? {} : { message: { id: "unrelated-message" } }));
      return Promise.resolve(Response.json({ message: {
        id: "confirmed-message", clientMessageId: body.clientMessageId, purchaseRequestId: current.request.id,
        kind: "user", senderUserId: buyer.id, senderRole: buyer.role, message: body.message,
        createdAt: "2026-09-22T00:00:02.000Z", readByUserIds: [buyer.id],
      } }));
    }
    return Promise.resolve(Response.json(current));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  const draft = await screen.findByPlaceholderText("Type a message...") as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "Please confirm when you are ready." } });
  fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
  await waitFor(() => expect(draft.value).toBe("Please confirm when you are ready."));
  expect(bodies).toHaveLength(2);
  expect(new Set(bodies.map(body => body.clientMessageId)).size).toBe(1);
  confirm = true;
  fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(new Set(bodies.map(body => body.clientMessageId)).size).toBe(1);
  await waitFor(() => expect(draft.value).toBe(""));
  expect(document.querySelector('[data-trade-message-id="confirmed-message"]')).toBeTruthy();
});

it.each([
  ["Face-to-Face (Meet in Person)", "funds_received"],
  ["Bank Transfer", "usdt_sent"],
] as const)("completes %s through the visible seller action and opens feedback", async (method, status) => {
  let current = room(method, status);
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      current = { ...current, request: { ...current.request, status: "review_open", updatedAt: "2026-09-22T00:00:02.000Z" } };
      return Promise.resolve(Response.json({ request: current.request }));
    }
    return Promise.resolve(Response.json(current));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark Trade as Completed" }));
  await answerActionDialog();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "Trade Completed Successfully" })).toBeTruthy();
  const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ action: "complete_trade", usdtSentConfirmed: true });
  expect(screen.queryByRole("button", { name: "Mark Trade as Completed" })).toBeNull();
  if (method === "Bank Transfer") {
    expect(screen.getByRole("main").textContent).toContain("Seller confirmed payment and USDT delivery. Trade completed.");
    expect(screen.getByRole("main").textContent).not.toMatch(/buyer confirmed receipt|Buyer confirmation:/i);
  }
});

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
    if (method !== "Bank Transfer") await answerActionDialog();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect((screen.getByRole("button", { name: "Processing..." }) as HTMLButtonElement).disabled).toBe(true);
    current = { ...current, request: { ...current.request, status: "funds_received", updatedAt: "2026-09-22T00:00:01.000Z" } };
    await act(async () => response.resolve(Response.json({ request: current.request })));
    const action = await screen.findByRole("button", { name: method === "Bank Transfer" ? "Release USDT" : method === "Face-to-Face (Meet in Person)" ? "Mark Trade as Completed" : "Confirm USDT Sent" });
    const card = document.getElementById("action-required")!;
    expect(card.contains(action)).toBe(true);
    expect(card.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByTestId("trade-progress-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Adjustment stays disabled after payment has been confirmed.
    expect((screen.getByRole("button", { name: "Adjust Amount" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("trade-amount-locked")).toBeTruthy();
    expect(card.querySelector("button:not(:disabled)")).toBe(action);
    expect(within(card).getByTestId("trade-action-feedback")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(navigation.push).not.toHaveBeenCalled();
    // A later counterparty confirmation must replace the earlier success label.
    current = { ...current, request: { ...current.request, status: "review_open", updatedAt: "2026-09-22T00:00:05.000Z" } };
    await act(async () => RoomStream.instances.at(-1)!.snapshot(current));
    expect(await screen.findByRole("heading", { name: "Trade Completed Successfully" })).toBeTruthy();
    expect(screen.queryByTestId("trade-action-feedback")).toBeNull();
  });

  it("keeps the original stage and offers retry after a failed action", async () => {
    const current = room(method, "pending");
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH"
      ? Response.json({ error: "Temporarily unavailable" }, { status: 503 }) : Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept Trade" }));
    await answerActionDialog();
    if (method === "Face-to-Face (Meet in Person)") {
      expect(await answerActionDialog()).toContain("safe public place");
    }
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Temporarily unavailable");
    expect(document.getElementById("action-required")!.contains(error)).toBe(true);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect((screen.getByRole("button", { name: "Accept Trade" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s live recovery", (method) => {
  it("pauses background requests offline and reconnects once with the saved trade and draft intact", async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const current = room(method, "accepted");
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />); });
    fireEvent.change(screen.getByPlaceholderText("Type a message..."), { target: { value: "My unsent draft" } });
    const oldStream = RoomStream.instances[0];
    await act(async () => oldStream.snapshot(current));
    // A failure may already have scheduled a reconnect when connectivity drops.
    await act(async () => oldStream.dispatchEvent(new Event("error")));
    online.mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    const reads = fetchMock.mock.calls.length;
    const streams = RoomStream.instances.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(reads);
    expect(RoomStream.instances).toHaveLength(streams);
    expect((screen.getByPlaceholderText("Type a message...") as HTMLTextAreaElement).value).toBe("My unsent draft");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(reads + 1);
    expect(RoomStream.instances).toHaveLength(streams + 1);
    expect(navigation.push).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText("Type a message...") as HTMLTextAreaElement).value).toBe("My unsent draft");
  });

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

describe.each(["en", "ar"] as const)("completed-trade history navigation (%s)", (locale) => {
  it.each([
    [buyer, "/trades"],
    [seller, "/trades"],
    [{ ...seller, role: "owner" as const }, "/trades"],
    [{ id: "oversight-owner", fullName: "Owner", role: "owner" as const }, "/admin/alpha-exchange?section=purchase-requests&requestId=feedback-request&details=1"],
  ] as const)("opens the history for %j without mutating the trade", async (actor, destination) => {
    const current = room("Face-to-Face (Meet in Person)", "completed");
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={actor} />);
    fireEvent.click(await screen.findByRole("button", { name: locale === "ar" ? "عرض سجل الصفقات" : "View Trade History" }));
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});

it.each(["en", "ar"] as const)("puts pending terms decisions first in %s", async (locale) => {
  const base = room("Cardless ATM Withdrawal", "accepted");
  const current = { ...base, request: { ...base.request, termsProposal: { id: "terms-1", kind: "amount_correction", status: "pending", usdtAmount: "100", fiatAmount: "310", pricePerUsdt: "3.10", createdAt: base.request.updatedAt } } };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
  const accept = await screen.findByRole("button", { name: locale === "ar" ? "موافقة على الشروط" : "Accept these terms" });
  expect((accept as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByTestId("trade-amount-action").querySelector("button")).toBe(accept);
  expect(accept.compareDocumentPosition(document.getElementById("status-banner")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByTestId("trade-primary-action")).toBeNull();
  expect(screen.queryByText("No required action at this moment.")).toBeNull();
});

it.each(["newer", "older"] as const)("reconciles a %s queued payment snapshot after an accepted amount approval", async order => {
  const initial = room("Bank Transfer", "accepted");
  const proposal = { id: "amount-pending", kind: "amount_correction" as const, status: "pending" as const, usdtAmount: "125", fiatAmount: "400.00", pricePerUsdt: "3.20", createdAt: initial.request.updatedAt };
  const current = { ...initial, request: { ...initial.request, termsProposal: proposal } };
  const approved = { ...current.request, usdtAmount: "125", fiatAmount: "400.00", pricePerUsdt: "3.20", termsProposal: { ...proposal, status: "accepted" as const }, updatedAt: "2026-09-22T00:00:03.000Z" };
  const queued = { ...current, request: { ...approved, status: "payment_sent" as const, updatedAt: order === "newer" ? "2026-09-22T00:00:04.000Z" : "2026-09-22T00:00:02.000Z" } };
  const response = deferredResponse();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept these terms" }));
  await act(async () => RoomStream.instances.at(-1)!.snapshot(queued));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("20");
  await act(async () => response.resolve(Response.json({ request: approved })));
  await waitFor(() => expect(readTradeRoomCache<ReturnType<typeof room>>("feedback-request", buyer.id)?.request.status).toBe(order === "newer" ? "payment_sent" : "accepted"));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(order === "newer" ? "40" : "20");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});

it("keeps copy and reminder feedback beside the chat controls", async () => {
  const current = room("Face-to-Face (Meet in Person)", "accepted");
  current.poke.available = true;
  current.poke.canPoke = true;
  current.poke.counterpartRole = "seller";
  vi.stubGlobal("navigator", Object.create(navigator, { onLine: { value: true }, clipboard: { value: { writeText: vi.fn().mockResolvedValue(undefined) } } }));
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
    await answerActionDialog();
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ status: "cancelled" });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => response.resolve(Response.json({ request: { ...current.request, status: "cancelled" } })));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/usdt-exchange"));
  });

  it("allows leaving an accepted cardless request before code submission", async () => {
    const current = room("Cardless ATM Withdrawal", "accepted");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    const cancel = await screen.findByRole("button", { name: "Cancel Trade" });
    const code = screen.getByLabelText("1. Withdrawal code");
    expect(cancel.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cancel);
    expect(await answerActionDialog(false)).toContain("Cancel only if neither participant");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each(["payment_sent", "funds_received", "usdt_sent", "review_open", "cancelled"] as const)("explains locked cancellation while keeping terminal trades closed at %s", async (status) => {
    const current = room("Cardless ATM Withdrawal", status);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
    await screen.findByTestId("trade-details");
    if (status === "review_open" || status === "cancelled") {
      expect(screen.queryByRole("button", { name: "Cancel Trade" })).toBeNull();
    } else {
      const cancel = screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement;
      expect(cancel.disabled).toBe(true);
      expect(screen.getByTestId("trade-cancel-action").textContent).toContain("Cancellation is locked");
      fireEvent.click(cancel);
      expect(window.confirm).not.toHaveBeenCalled();
    }
  });
});

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s management controls", (method) => {
  it.each(["en", "ar"] as const)("shows buyer cancellation without an unusable adjustment control in %s", async (locale) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, "pending")))));
    render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
    const cancel = await screen.findByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel Trade" });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: locale === "ar" ? "تعديل المبلغ" : "Adjust Amount" })).toBeNull();
  });

  it("cancels a seller's pending request through the existing decline action", async () => {
    const current = room(method, "pending");
    const fetch = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH" ? Response.json({ request: { ...current.request, status: "declined" } }) : Response.json(current)));
    vi.stubGlobal("fetch", fetch);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const cancel = await screen.findByRole("button", { name: "Cancel Trade" });
    expect(cancel.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cancel);
    await answerActionDialog();
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    const patch = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ status: "declined" });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("allows accepted amount editing until a confirmed payment update arrives", async () => {
    const current = room(method, "accepted");
    const fetch = vi.fn(() => Promise.resolve(Response.json(current)));
    vi.stubGlobal("fetch", fetch);
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    await screen.findByTestId("trade-details");
    const adjust = screen.getByRole("button", { name: "Adjust Amount" }) as HTMLButtonElement;
    expect(adjust.disabled).toBe(false);
    fireEvent.click(adjust);
    const label = method === "Cardless ATM Withdrawal" ? "New withdrawal amount (ILS)" : "Correct USDT amount";
    fireEvent.change(screen.getByLabelText(label), { target: { value: "300" } });
    await act(async () => RoomStream.instances.at(-1)!.snapshot({ ...current, request: { ...current.request, status: "payment_sent", updatedAt: "2026-09-22T00:00:02.000Z" } }));
    expect((screen.getByRole("button", {name:"Adjust Amount"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.getByTestId("trade-amount-locked")).toBeTruthy();
  });

  it("opens the pending seller amount editor beside the acceptance action", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, "pending")))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    const adjust = await screen.findByRole("button", { name: "Adjust Amount" });
    expect((adjust as HTMLButtonElement).disabled).toBe(false);
    expect(adjust.compareDocumentPosition(document.getElementById("status-banner")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(adjust);
    const amount = screen.getByLabelText(method === "Cardless ATM Withdrawal" ? "New withdrawal amount (ILS)" : "Correct USDT amount");
    expect(amount.compareDocumentPosition(screen.getByTestId("trade-details")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept Trade" })).toBeTruthy();
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
    await answerActionDialog();
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
    await answerActionDialog();
    expect(await screen.findByText("Payment has already started. Refresh the trade.")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)("locks seller cancellation and amount adjustment at %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(room(method, status)))));
    render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
    await screen.findByTestId("trade-details");
    const cancel = screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(window.confirm).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Adjust Amount" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("trade-amount-locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adjust USDT to withdrawal amount" })).toBeNull();
  });
});

it("requires the seller's confirmation before cancelling", async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(Response.json(room("Bank Transfer", "accepted"))));
  vi.stubGlobal("fetch", fetch);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Trade" }));
  await answerActionDialog(false);
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
  await screen.findByTestId("trade-details");
  const cancel = screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  expect(window.confirm).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Adjust Amount" }) as HTMLButtonElement).disabled).toBe(true);
});

it("proposes a new cardless cash amount once and keeps the old total until buyer approval", async () => {
  const base = room("Cardless ATM Withdrawal", "pending");
  const current = { ...base, request: { ...base.request, usdtAmount: "125", fiatAmount: "400.00", pricePerUsdt: "3.20" } };
  const response = deferredResponse();
  const fetch = vi.fn((_url: string, init?: RequestInit) => init?.method === "PATCH" ? response.promise : Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetch);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  fireEvent.click(await screen.findByRole("button", { name: "Adjust Amount" }));
  fireEvent.change(screen.getByLabelText("New withdrawal amount (ILS)"), { target: { value: "200" } });
  expect(screen.getByTestId("trade-adjustment-preview").textContent).toContain("62.5 USDT");
  const adjust = screen.getByRole("button", { name: "Propose corrected amount" });
  fireEvent.click(adjust); fireEvent.click(adjust);
  const patches = fetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({ action: "propose_ils_amount", value: "200" });
  await act(async () => response.resolve(Response.json({ request: { ...current.request, termsProposal: { id: "new-cash", kind: "amount_correction", status: "pending", usdtAmount: "62.5", fiatAmount: "200.00", pricePerUsdt: "3.20", createdAt: current.request.updatedAt } } })));
  expect(screen.getByTestId("inclusive-payment-total").textContent).toContain("400.00");
  expect(await screen.findByRole("button", { name: "Withdraw proposal" })).toBeTruthy();
});

it.each([
  ["Face-to-Face (Meet in Person)", "accepted", "I Received the Cash"],
  ["Cardless ATM Withdrawal", "payment_sent", "I Collected the ATM Cash"],
  ["Bank Transfer", "payment_sent", "Confirm Money Received"],
] as const)("requires full inclusive payment confirmation for %s", async (method, status, button) => {
  const base = room(method, status);
  const current = { ...base, request: { ...base.request, fiatAmount: "3232.00", usdtAmount: "1000", pricePerUsdt: "3.20", feePolicyVersion: "buyer_seller_1pct_v1" } };
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PATCH" ? Response.json({ request: { ...current.request, status: "funds_received" } }) : Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  const confirm = await screen.findByRole("button", { name: button });
  expect(screen.getByTestId("inclusive-payment-total").textContent).toContain("ILS 3,232.00");
  expect(screen.getByTestId("inclusive-payment-total").textContent).toContain("Buyer’s 1% fee included.");
  fireEvent.click(confirm);
  expect(await answerActionDialog(false)).toContain("I confirm I received the full ILS 3,232.00, including the buyer’s 1% fee");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  fireEvent.click(confirm);
  await answerActionDialog();
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body))).toMatchObject({ status: "funds_received" });
});


it("places bank details below upload controls and above cancellation", async () => {
  const current = room("Bank Transfer", "accepted");
  Object.assign(current.request, { sellerBankAccountId: "bank-1" });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={buyer} />);
  const reveal = await screen.findByRole("button", { name: "Reveal Bank Details" });
  const upload = screen.getByTestId("trade-evidence-picker");
  const cancel = screen.getByTestId("trade-cancel-action");
  expect(upload.compareDocumentPosition(reveal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reveal.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Adjust Amount" })).toBeNull();
});


it.each(["en", "ar"] as const)("explains the buyer bank-disclosure lock without hiding cancellation in %s", async locale => {
  const current = room("Bank Transfer", "accepted");
  Object.assign(current.request, { sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: current.request.updatedAt });
  const fetchMock = vi.fn(() => Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
  const cancel = await screen.findByRole("button", { name: locale === "ar" ? "إلغاء الصفقة" : "Cancel Trade" }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  expect(screen.getByTestId("trade-cancel-action").textContent).toContain(locale === "ar" ? "يمكن للبائع فقط" : "Only the seller");
  expect(cancel.getAttribute("aria-describedby")).toBe("trade-cancel-help");
  fireEvent.click(cancel);
  expect(window.confirm).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["en", "ar"] as const)("removes pending manual-close controls when the buyer's bank-disclosure lock arrives in %s", async locale => {
  const current = room("Bank Transfer", "pending");
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(current)));
  vi.stubGlobal("fetch", fetchMock);
  render(<TradeRoomPage locale={locale} requestId="feedback-request" actor={buyer} />);
  fireEvent.click(await screen.findByRole("button", { name: locale === "ar" ? "إغلاق الصفقة" : "Close Trade" }));
  const reason = await screen.findByLabelText(locale === "ar" ? "سبب إغلاق الصفقة" : "Trade close reason");
  fireEvent.change(reason, { target: { value: "Please close this request" } });
  const disclosed = { ...current, request: { ...current.request,
    sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: "2026-09-22T00:00:01.000Z",
    updatedAt: "2026-09-22T00:00:01.000Z",
  } };
  await act(async () => RoomStream.instances.at(-1)!.snapshot(disclosed));
  expect(screen.queryByLabelText(locale === "ar" ? "سبب إغلاق الصفقة" : "Trade close reason")).toBeNull();
  expect(screen.queryByRole("button", { name: locale === "ar" ? "تأكيد الإغلاق اليدوي" : "Confirm Manual Close" })).toBeNull();
  expect(screen.getByTestId("trade-cancel-action").textContent).toContain(locale === "ar" ? "يمكن للبائع فقط" : "Only the seller");
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it("preserves the seller's pending close control after buyer bank disclosure", async () => {
  const current = room("Bank Transfer", "pending");
  Object.assign(current.request, { sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: current.request.updatedAt });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={seller} />);
  const close = await screen.findByRole("button", { name: "Close Trade" }) as HTMLButtonElement;
  expect(close.disabled).toBe(false);
  fireEvent.click(close);
  expect(screen.getByLabelText("Trade close reason")).toBeTruthy();
});

it.each([buyer, seller])("hides pending manual close from $role after recorded payment progress", async actor => {
  const current = room("Cardless ATM Withdrawal", "pending");
  Object.assign(current.request, { fundsReceivedAt: current.request.updatedAt });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(current))));
  render(<TradeRoomPage locale="en" requestId="feedback-request" actor={actor} />);
  await screen.findByTestId("trade-room-summary");
  expect(screen.queryByRole("button", { name: "Close Trade" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm Manual Close" })).toBeNull();
});
