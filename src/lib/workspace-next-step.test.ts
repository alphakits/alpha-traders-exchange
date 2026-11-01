import { describe, expect, it } from "vitest";
import { workspaceTradeNextStep } from "./workspace-next-step";
import type { PurchaseRequestStatus } from "@/types/alpha-exchange";
describe("role-based next steps", () => {
  it.each(["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "locked", "completed"] as PurchaseRequestStatus[])("preserves the %s lifecycle while providing both languages", status => {
    const request = { status }; const before = JSON.stringify(request);
    for (const side of ["buyer", "seller"] as const) { expect(workspaceTradeNextStep(request, side, false).length).toBeGreaterThan(15); expect(workspaceTradeNextStep(request, side, true)).toMatch(/[\u0600-\u06ff]/); }
    expect(JSON.stringify(request)).toBe(before);
  });
  it("directs the seller to verify actual funds while a buyer waits", () => { expect(workspaceTradeNextStep({ status: "payment_sent" }, "seller", false)).toContain("actual receipt"); expect(workspaceTradeNextStep({ status: "payment_sent" }, "buyer", false)).toContain("seller is checking"); });
});
