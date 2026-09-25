import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommissionCheckoutPanel } from "./commission-checkout-panel";
const wallet = "0x7088a120cde7351dbf3e7831a9da3f74058c89a0";
const ready = { status: "ready", checkout: null, walletAddress: null, pendingCount: 1, totalDueUsdt: 40 };
const waiting = { ...ready, status: "waiting", walletAddress: wallet, checkout: { id: "checkout", sellerId: "seller", network: "BEP20", expectedMicros: 39_000_000, dueMicros: 40_000_000 } };
const fetchMock = vi.fn();
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockResolvedValue(response(ready)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not permit payment creation without pre-payment acknowledgement", async () => {
  render(<CommissionCheckoutPanel isAr={false} />);
  const button = await screen.findByRole("button", { name: "Prepare payment for all commissions" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(wallet)).toBeNull();
});
it("39 for 40 is requested by seller and waits for independent verification, not owner approval", async () => {
  render(<CommissionCheckoutPanel isAr={false} />);
  fireEvent.change(await screen.findByLabelText("Amount you plan to send (USDT)"), { target: { value: "39" } });
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: "BEP20" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fetchMock.mockResolvedValueOnce(response({ status: "waiting" }, 201)).mockResolvedValue(response(waiting));
  fireEvent.click(screen.getByRole("button", { name: "Prepare payment for all commissions" }));
  await screen.findByText("39.000000 USDT");
  const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
  expect(JSON.parse(post?.[1].body)).toEqual({ network: "BEP20", desiredAmount: "39", hasNotPaidYet: true });
  expect(screen.queryByText(/Payment verified\. No commission/)).toBeNull();
  expect(screen.getByText(/No screenshot, transaction-ID submission or owner approval/)).toBeTruthy();
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
  expect(screen.queryByText(/No commission dues remain/)).toBeNull();
});
it("provider/backend outage hides payment controls rather than requesting duplicate payment", async () => {
  fetchMock.mockRejectedValue(Error("unavailable")); render(<CommissionCheckoutPanel isAr={false} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Do not send another payment");
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("paid result is displayed only after a successful status read", async () => {
  fetchMock.mockResolvedValue(response({ ...ready, status: "paid", pendingCount: 0, totalDueUsdt: 0 }));
  render(<CommissionCheckoutPanel isAr={false} />); await screen.findByText(/Payment verified\. No commission dues remain/);
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("Arabic uses the same owner-free workflow and localized entry", async () => {
  render(<CommissionCheckoutPanel isAr />); await screen.findByText("دفع العمولات تلقائيًا");
  await waitFor(() => expect(screen.getByRole("button", { name: "إنشاء دفعة لجميع العمولات" })).toBeTruthy());
  expect(screen.getByRole("link", { name: "العودة للسوق" }).getAttribute("href")).toBe("/ar/usdt-exchange");
});
it("changed commission group does not show instructions to resend", async () => {
  fetchMock.mockResolvedValue(response({ ...waiting, status: "changed" })); render(<CommissionCheckoutPanel isAr={false} />);
  await screen.findByText(/These commissions changed/); expect(screen.queryByText(wallet)).toBeNull();
});
