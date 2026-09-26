import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OwnerAccountControls } from "./owner-account-controls";
import { availableOwnerAccountCommands, executeOwnerAccountCommand, matchesOwnerAccountCommandState } from "@/lib/owner-account-command";

const target = { id: "seller-test", fullName: "AT-123456 (Test Seller)", role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller", disabled: false };
const suspended = { ...target, role: "buyer", roles: ["buyer"], sellerStatus: "suspended" };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("routes seller removal through seller enforcement, never generic role changes", async () => {
  expect(availableOwnerAccountCommands(target)).toEqual(["disable", "suspend", "revoke_seller"]);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ enforcement: { latestRecord: { sellerId: target.id, status: "revoked" } } }));
  const result = await executeOwnerAccountCommand(target, "revoke_seller", "Outside-platform trading", undefined, fetcher);
  expect(result.outcome).toBe("saved");
  expect(fetcher.mock.calls[0][0]).toBe(`/api/alpha-exchange/admin/sellers/${target.id}/enforcement`);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: "revoke_seller", reason: "Outside-platform trading" });
  expect(matchesOwnerAccountCommandState({ ...target, sellerStatus: "buyer" }, "revoke_seller")).toBe(false);
  expect(matchesOwnerAccountCommandState({ ...suspended, sellerStatus: "buyer" }, "revoke_seller")).toBe(true);
});
it("protects owners, separates disabled accounts, and does not bypass seller approval", () => {
  expect(availableOwnerAccountCommands({ ...target, roles: ["owner"], disabled: true })).toEqual([]);
  expect(availableOwnerAccountCommands({ ...suspended, disabled: true })).not.toContain("reactivate");
  expect(availableOwnerAccountCommands(suspended)).toContain("reactivate");
  expect(matchesOwnerAccountCommandState({ ...target, disabled: undefined }, "reactivate")).toBe(false);
});
it.each([401, 403, 400, 408, 500])("does not claim a save on HTTP %s", async (status) => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status }));
  const result = await executeOwnerAccountCommand(target, "suspend", "Reason", undefined, fetcher);
  expect(result.outcome).toBe(status >= 500 || status === 408 ? "unknown" : "rejected");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("never displays controls to non-owners", () => {
  render(<OwnerAccountControls locale="en" target={target} isOwner={false} onRefresh={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("suspends once and confirms against fresh state", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ seller: suspended }));
  vi.stubGlobal("fetch", fetcher);
  const refresh = vi.fn().mockResolvedValue(suspended);
  render(<OwnerAccountControls locale="en" target={target} isOwner onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "suspend" } });
  fireEvent.change(screen.getByLabelText("Reason (required for the audit record)"), { target: { value: "Rule violation" } });
  const form = screen.getByRole("dialog").querySelector("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByText("Change saved and verified against the refreshed account state.");
  expect(fetcher).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
});
it("keeps uncertain saves distinct and never retries a mutation after refresh failure", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true })); vi.stubGlobal("fetch", fetcher);
  render(<OwnerAccountControls locale="en" target={target} isOwner onRefresh={vi.fn().mockResolvedValue(null)} />);
  fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
  fireEvent.change(screen.getByLabelText("Reason (required for the audit record)"), { target: { value: "Reason" } });
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  await screen.findByText(/current account state could not be reconciled/);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  expect(fetcher).toHaveBeenCalledOnce();
});
