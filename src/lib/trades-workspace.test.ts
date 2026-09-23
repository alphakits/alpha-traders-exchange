import { describe, expect, it } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { groupOwnTrades } from "./trades-workspace";
const request = (id: string, status: PurchaseRequest["status"], date: string, buyerId = "buyer", sellerId = "seller") => ({ id, status, buyerId, sellerId, createdAt: date, updatedAt: date } as PurchaseRequest);
describe("role-specific trades ordering", () => {
  it.each(["buyer", "seller"] as const)("puts newest own requests first and completed history afterwards for %s", side => {
    const rows = [request("older", "accepted", "2026-09-20"), request("finished-old", "completed", "2026-09-19"), request("newest", "pending", "2026-09-23"), request("finished-latest", "review_open", "2026-09-22"), request("other-user", "pending", "2026-09-24", "someone-else", "another-seller"), request("cancelled", "cancelled", "2026-09-21")];
    const groups = groupOwnTrades(rows, side, side);
    expect(groups.active.map(row => row.id)).toEqual(["newest", "older"]);
    expect(groups.completed.map(row => row.id)).toEqual(["finished-latest", "finished-old"]);
    expect(groups.closed.map(row => row.id)).toEqual(["cancelled"]);
  });
  it("keeps a seller's purchases separate from their sales and sorts history by completion time", () => {
    const sale = { ...request("sale", "completed", "2026-09-01"), completedAt: "2026-09-23" };
    const ownPurchase = request("purchase", "pending", "2026-09-22", "seller", "someone-else");
    const otherSale = request("earlier-completion", "locked", "2026-09-20");
    expect(groupOwnTrades([sale, ownPurchase, otherSale], "seller", "seller").completed.map(row => row.id)).toEqual(["sale", "earlier-completion"]);
    expect(groupOwnTrades([sale, ownPurchase, otherSale], "seller", "buyer").active.map(row => row.id)).toEqual(["purchase"]);
  });
});
