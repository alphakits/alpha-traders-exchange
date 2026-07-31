import { describe, expect, it } from "vitest";
import { getSellerWorkspaceHighlights } from "@/lib/premium-seller-dashboard";

describe("getSellerWorkspaceHighlights", () => {
  it("returns a compact set of dashboard highlights for the seller workspace", () => {
    const highlights = getSellerWorkspaceHighlights({
      openListings: 2,
      pendingActions: 4,
      bankReadyTrades: 1,
      completedTrades: 18,
      successRate: 97.4,
    });

    expect(highlights).toHaveLength(5);
    expect(highlights[0]).toMatchObject({ label: "Open listings", value: "2" });
    expect(highlights[1]).toMatchObject({ label: "Pending actions", value: "4" });
    expect(highlights[4]).toMatchObject({ label: "Success rate", value: "97.4%" });
  });
});
