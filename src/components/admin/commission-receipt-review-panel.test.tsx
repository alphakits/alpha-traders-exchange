import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommissionReceiptReviewPanel } from "./commission-receipt-review-panel";
const originalReceipt = `binance-deposit:123456789123456789`;
const state = { enabled: true, batches: [], settlements: [], commissions: [{ id: "cm40", displayNumber: 40, sellerId: "seller", sellerName: "Test Seller", commissionAmount: 40, hasPaymentInProgress: false }] };
const history = (amount = 39_000_000) => ({ receipts: [{ signature: originalReceipt, network: "BEP20", amountMicros: amount, timestamp: Date.now() - 1000, conflicting: false, reserved: false }], complete: true, truncated: false, checkedAt: new Date().toISOString() });
let fetchMock: ReturnType<typeof vi.fn>;
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
beforeEach(() => {
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => options?.method === "POST"
    ? response({ batchId: "batch", status: "awaiting_receipt_verification" }, 202)
    : response(url.endsWith("commission-receipts") ? history() : state));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function choose() {
  await screen.findByText("Grouped settlement enabled — receipt confirmation is always required.");
  fireEvent.change(screen.getByLabelText("Seller"), { target: { value: "seller" } });
  fireEvent.click(screen.getByLabelText(/CM-000040/));
  fireEvent.click(screen.getByRole("button", { name: /Load receipts/ }));
  await waitFor(() => expect(screen.getByLabelText("Receipt").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Receipt"), { target: { value: `BEP20:${originalReceipt}` } });
}
it("40 owed / 39 received requires payer confirmation, then queues verification, never claims paid", async () => {
  render(<CommissionReceiptReviewPanel locale="en" />); await choose();
  const button = screen.getByRole("button", { name: "Link receipt for automatic verification" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I independently confirmed/)); expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await screen.findByText(/Receipt linked. Not marked paid yet/);
  const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST"); expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ sellerId: "seller", commissionIds: ["cm40"], signature: originalReceipt, network: "BEP20", confirmedOriginalPayer: true });
});
it("a shortfall greater than one dollar never enables approval", async () => {
  fetchMock.mockImplementation(async (url: string) => response(url.endsWith("commission-receipts") ? history(38_999_999) : state));
  render(<CommissionReceiptReviewPanel locale="en" />); await choose(); fireEvent.click(screen.getByLabelText(/I independently confirmed/));
  expect((screen.getByRole("button", { name: "Link receipt for automatic verification" }) as HTMLButtonElement).disabled).toBe(true);
});
it("disabled release never enables an approval", async () => { fetchMock.mockResolvedValue(response({ ...state, enabled: false })); render(<CommissionReceiptReviewPanel locale="en" />); await screen.findByText("Grouped settlement is not enabled yet."); expect((screen.getByRole("button", { name: "Link receipt for automatic verification" }) as HTMLButtonElement).disabled).toBe(true); });
it("a failed state read does not display a false clear balance", async () => { fetchMock.mockImplementation(async () => response({ error: "unavailable" }, 503)); render(<CommissionReceiptReviewPanel locale="en" />); await screen.findByRole("alert"); expect(screen.queryByText(/Grouped settlement enabled/)).toBeNull(); });
it("forbidden state never exposes a receipt-loading control", async () => { fetchMock.mockImplementation(async () => response({ error: "Forbidden" }, 403)); render(<CommissionReceiptReviewPanel locale="en" />); await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: /Load receipts/ })).toBeNull(); });
it("failed mutation does not automatically retry a financial write", async () => {
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => options?.method === "POST" ? response({ error: "unavailable" }, 503) : response(url.endsWith("commission-receipts") ? history() : state));
  render(<CommissionReceiptReviewPanel locale="en" />); await choose(); fireEvent.click(screen.getByLabelText(/I independently confirmed/)); fireEvent.click(screen.getByRole("button", { name: "Link receipt for automatic verification" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1));
  await waitFor(() => expect((screen.getByLabelText(/I independently confirmed/) as HTMLInputElement).checked).toBe(false));
  expect(screen.queryByText(/Receipt linked. Not marked paid yet/)).toBeNull();
});
it("partial history is explicitly distinguished from complete history", async () => {
  fetchMock.mockImplementation(async (url: string) => response(url.endsWith("commission-receipts") ? { ...history(), complete: false } : state));
  render(<CommissionReceiptReviewPanel locale="en" />); await choose(); await screen.findByText(/Receipt history is partial/);
});
it("Arabic panel preserves the payer-identification warning", async () => { render(<CommissionReceiptReviewPanel locale="ar" />); await screen.findByRole("heading", { name: "مطابقة إيصالات العمولات" }); expect(screen.getByText(/المطابقة الدقيقة تلقائية/)).toBeTruthy(); });
