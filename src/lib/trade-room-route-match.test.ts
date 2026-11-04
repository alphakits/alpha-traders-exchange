import { describe, expect, it } from "vitest";
import { matchesTradeRoomRoute } from "./trade-room-route-match";

describe("canonical Trade Room URL matching", () => {
  const request = { id: "purchase-abc", tradeId: "trade-xyz" };
  it.each(["purchase-abc", "abc", "trade-xyz", "purchase-trade-xyz", "purchase-purchase-abc", "  abc  "])("accepts the server-supported alias %s", routeId => {
    expect(matchesTradeRoomRoute(request, routeId)).toBe(true);
  });
  it.each(["", " ", "purchase-", "other", "trade-other", "purchase-other", "purchase-purchase-purchase-abc", "ABC", "abc/other"])("refuses an unrelated or malformed route %s", routeId => {
    expect(matchesTradeRoomRoute(request, routeId)).toBe(false);
  });
  it("handles legacy unprefixed request IDs without accepting arbitrary rooms", () => {
    expect(matchesTradeRoomRoute({ id: "abc" }, "purchase-abc")).toBe(true);
    expect(matchesTradeRoomRoute({ id: "abc" }, "trade-xyz")).toBe(false);
  });
});
