import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommissionCheckoutPanel } from "./commission-checkout-panel";
import { CANONICAL_TRC20_COMMISSION_WALLET } from "@/lib/commission-config";
const wallet = "0x7088a120cde7351dbf3e7831a9da3f74058c89a0";
const ready = { status: "ready", checkout: null, walletAddress: null, pendingCount: 1, totalDueUsdt: 40 };
const waiting = { ...ready, status: "waiting", walletAddress: wallet, checkout: { id: "checkout", sellerId: "seller", network: "BEP20", expectedMicros: 39_000_000, dueMicros: 40_000_000 } };
const tronWallet = CANONICAL_TRC20_COMMISSION_WALLET;
const fetchMock = vi.fn();
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(response(ready));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); }); }
it.each([false, true])("discloses the carried balance after a verified payment (Arabic=%s)", async isAr => {
  fetchMock.mockResolvedValue(response({ ...ready, status: "paid", pendingCount: 0, totalDueUsdt: 0, carriedShortfallUsdt: 2 }));
  render(<CommissionCheckoutPanel isAr={isAr} />);
  await screen.findByText(isAr ? /رصيد غير مدفوع يُرحّل/ : /Unpaid balance carried/);
  expect(screen.getByText("2 USDT")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(/Paid\. No commission due\./)).toBeNull();
});
it.each([0.002, 8.304056])("prefills the exact %s commission without rounding it to cents", async totalDueUsdt => {
  fetchMock.mockResolvedValue(response({ ...ready, totalDueUsdt }));
  render(<CommissionCheckoutPanel isAr={false} />);
  const input = await screen.findByLabelText("Amount to receive (USDT)");
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(String(totalDueUsdt)));
});
it.each([false, true])("copies the exact net receipt target without adding the example network fee (Arabic=%s)", async isAr => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    fetchMock.mockResolvedValue(response({ ...waiting, checkout: { ...waiting.checkout, expectedMicros: 40_000_001 } }));
    render(<CommissionCheckoutPanel isAr={isAr} />);
    fireEvent.click(await screen.findByRole("button", { name: isAr ? "نسخ مبلغ الاستلام" : "Copy receive amount" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("40.000001"));
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
it("opens a network change without old wallet controls, permits cancellation, and requires acknowledgement", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, canChangeNetwork: true }));
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change network" }));
  expect(screen.queryByText(wallet)).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy receiving address" })).toBeNull();
  expect(screen.queryByLabelText("Amount to receive (USDT)")).toBeNull();
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: "TRC20" } });
  expect((screen.getByRole("button", { name: "Update payment network" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep current network" }));
  expect(screen.getByText(wallet)).toBeTruthy();
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
});
it("switches TRC20 to BEP20 using canonical new instructions and clears the acknowledgement", async () => {
  const initial = { ...waiting, canChangeNetwork: true, walletAddress: tronWallet,
    checkout: { ...waiting.checkout, id: "checkout-tron", network: "TRC20" } };
  fetchMock.mockResolvedValue(response(initial));
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change network" }));
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: "BEP20" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fetchMock.mockResolvedValueOnce(response({ status: "waiting" }, 201)).mockResolvedValue(response({ ...waiting, canChangeNetwork: true }));
  fireEvent.click(screen.getByRole("button", { name: "Update payment network" }));
  await screen.findByText(wallet);
  expect(screen.queryByText(tronWallet)).toBeNull();
  const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(post?.[1].body)).toEqual({ network: "BEP20", currentCheckoutId: "checkout-tron", hasNotPaidYet: true });
  fireEvent.click(screen.getByRole("button", { name: "Change network" }));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});
it("does not offer a network change after payment detection or settlement", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, canChangeNetwork: false, verificationCode: "receipt_pending" }));
  render(<CommissionCheckoutPanel isAr={false} />); await screen.findByText(wallet);
  expect(screen.queryByRole("button", { name: "Change network" })).toBeNull();
});
it("shows a rejected network change and restores canonical instructions", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, canChangeNetwork: true }));
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change network" }));
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: "TRC20" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fetchMock.mockResolvedValueOnce(response({ error: "payment_in_progress" }, 409))
    .mockResolvedValue(response({ ...waiting, canChangeNetwork: false, verificationCode: "receipt_pending" }));
  fireEvent.click(screen.getByRole("button", { name: "Update payment network" }));
  await screen.findByText("A payment is already being checked. Keep the current network and do not send again.");
  expect(screen.getByText(wallet)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change network" })).toBeNull();
});
it("does not permit payment creation without pre-payment acknowledgement", async () => {
  render(<CommissionCheckoutPanel isAr={false} />);
  const button = await screen.findByRole("button", { name: "Get payment instructions" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(wallet)).toBeNull();
});
it("39 for 40 is requested by seller and waits for independent verification, not owner approval", async () => {
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.change(await screen.findByLabelText("Amount to receive (USDT)"), { target: { value: "39" } });
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: "BEP20" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fetchMock.mockResolvedValueOnce(response({ status: "waiting" }, 201)).mockResolvedValue(response(waiting));
  fireEvent.click(screen.getByRole("button", { name: "Get payment instructions" }));
  await screen.findByText("39.000000 USDT");
  const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(post?.[1].body)).toEqual({ network: "BEP20", desiredAmount: "39", hasNotPaidYet: true });
  expect(screen.queryByText(/Paid\. No commission/)).toBeNull();
  expect(screen.getByText(/No screenshot, transaction ID, or owner approval/)).toBeTruthy();
});
it("hides recipient instructions when a backend amount/address response is invalid", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, walletAddress: "0x1111111111111111111111111111111111111111" }));
  render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByRole("alert"); expect(screen.queryByText("39.000000 USDT")).toBeNull();
});
it("401 clears private values and never becomes successful zero dues", async () => {
  fetchMock.mockResolvedValue(response(waiting)); render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByText(wallet);
  fetchMock.mockResolvedValue(response({ error: "Unauthorized" }, 401));
  fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
  await screen.findByText("Sign in with your seller account."); expect(screen.queryByText(wallet)).toBeNull();
  expect(screen.queryByText(/No commission due/)).toBeNull();
});
it("provider/backend outage hides payment controls rather than requesting duplicate payment", async () => {
  fetchMock.mockRejectedValue(Error("unavailable")); render(<CommissionCheckoutPanel isAr={false} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Do not send another payment");
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("paid result is displayed only after a successful status read", async () => {
  fetchMock.mockResolvedValue(response({ ...ready, status: "paid", pendingCount: 0, totalDueUsdt: 0 }));
  render(<CommissionCheckoutPanel isAr={false} />); await screen.findByText(/Paid\. No commission due/);
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("Arabic uses the same owner-free workflow and localized entry", async () => {
  render(<CommissionCheckoutPanel isAr />); await screen.findByText("دفع العمولة");
  await waitFor(() => expect(screen.getByRole("button", { name: "عرض تعليمات الدفع" })).toBeTruthy());
  expect(screen.getByRole("link", { name: "العودة للسوق" }).getAttribute("href")).toBe("/ar/usdt-exchange");
});
it("changed commission group does not show instructions to resend", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, status: "changed" })); render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByText(/The amount due changed/); expect(screen.queryByText(wallet)).toBeNull();
});
it("embedded checkout refreshes the seller workspace once after canonical paid status", async () => {
  const onSettled = vi.fn();
  fetchMock.mockResolvedValue(response(waiting));
  render(<CommissionCheckoutPanel isAr={false} embedded onSettled={onSettled} />);
  await screen.findByText(wallet);
  expect(screen.queryByRole("main")).toBeNull();
  expect(onSettled).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(response({ ...ready, status: "paid", pendingCount: 0, totalDueUsdt: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
  await waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(onSettled).toHaveBeenCalledOnce();
});
it.each(["fetch", "body"])("releases a stalled status %s and permits a fresh read", async (phase) => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce(() => phase === "fetch" ? new Promise(() => {})
    : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) }));
  render(<CommissionCheckoutPanel isAr={false} />); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(screen.getByRole("alert").textContent).toContain("Do not send another payment");
  fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" })); await flush();
  expect(screen.getByLabelText("Amount to receive (USDT)")).toBeTruthy();
});
it.each(["fetch", "body"])("reconciles a stalled checkout %s using a read without repeating the mutation", async (phase) => {
  vi.useFakeTimers();
  let issued = false;
  fetchMock.mockImplementation((_url, init) => {
    if (init?.method === "POST") {
      issued = true;
      return phase === "fetch" ? new Promise(() => {})
        : Promise.resolve({ ok: true, status: 201, json: () => new Promise(() => {}) });
    }
    return Promise.resolve(response(issued ? waiting : ready));
  });
  render(<CommissionCheckoutPanel isAr={false} />); await flush();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Get payment instructions" })); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); await flush();
  expect(screen.getByText("39.000000 USDT")).toBeTruthy();
  expect(screen.queryByText("Preparing…")).toBeNull();
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
});
it("hides private payment details immediately on sign-out and ignores a late read", async () => {
  let resolveRead!: (value: unknown) => void;
  fetchMock.mockResolvedValue(response(waiting));
  render(<CommissionCheckoutPanel isAr={false} />); await screen.findByText(wallet);
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh payment status" }));
  await flush();
  act(() => window.dispatchEvent(new Event("alpha-auth-signed-out")));
  expect(screen.queryByText(wallet)).toBeNull();
  await act(async () => { resolveRead(response(waiting)); });
  expect(screen.queryByText(wallet)).toBeNull();
  expect((screen.getByRole("button", { name: "Refresh payment status" }) as HTMLButtonElement).disabled).toBe(true);
});
it("clears authorization on a rejected mutation without waiting for its body", async () => {
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.click(await screen.findByRole("checkbox"));
  fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: () => new Promise(() => {}) });
  fireEvent.click(screen.getByRole("button", { name: "Get payment instructions" })); await flush();
  expect(screen.getByText("Sign in with your seller account.")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("replaces a cancelled locale read immediately and ignores its late response", async () => {
  let resolveRead!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
  const view = render(<CommissionCheckoutPanel isAr={false} />); await flush();
  view.rerender(<CommissionCheckoutPanel isAr />); await flush();
  expect(screen.getByLabelText("مبلغ الاستلام (USDT)")).toBeTruthy();
  await act(async () => { resolveRead(response(waiting)); });
  expect(screen.queryByText(wallet)).toBeNull();
});
it("pauses offline reads and recovers automatically when connectivity returns", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(<CommissionCheckoutPanel isAr={false} />); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetchMock).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("online"))); await flush();
  expect(screen.getByLabelText("Amount to receive (USDT)")).toBeTruthy();
});
it("rejects a contradictory paid result without notifying the workspace", async () => {
  const onSettled = vi.fn();
  fetchMock.mockResolvedValue(response({ ...ready, status: "paid", pendingCount: 0, totalDueUsdt: 40 }));
  render(<CommissionCheckoutPanel isAr={false} onSettled={onSettled} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/Payment verified/)).toBeNull();
  expect(onSettled).not.toHaveBeenCalled();
});
it("keeps the reserved rounded alternative available with a single-payment instruction", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, totalDueUsdt: 29.2,
    checkout: { ...waiting.checkout, dueMicros: 29_200_000, expectedMicros: 29_200_000, roundedMicros: 30_000_000 } }));
  render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByText("29.200000 USDT");
  expect(screen.getByText("30 USDT")).toBeTruthy();
  expect(screen.getByText(/Send only one payment/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy rounded amount" })).toBeTruthy();
});
it("hides instructions if a returned rounded option exceeds the allowed commission difference", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, checkout: { ...waiting.checkout, roundedMicros: 42_000_000 } }));
  render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(wallet)).toBeNull();
});

it.each([38_000_000, 42_000_000])("renders valid two-dollar-boundary instructions for %s micros", async (expectedMicros) => {
  fetchMock.mockResolvedValue(response({ ...waiting, checkout: { ...waiting.checkout, expectedMicros } }));
  render(<CommissionCheckoutPanel isAr={false} />);
  expect(await screen.findByText(`${(expectedMicros / 1e6).toFixed(6)} USDT`)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
