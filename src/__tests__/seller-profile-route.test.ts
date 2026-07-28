import { describe, expect, it } from "vitest";
import { deriveSellerRouteUsername, resolveSellerByUsername } from "@/lib/alpha-exchange-seller-profile";

describe("seller profile route helpers", () => {
  it("derives a clean route username from seller identity", () => {
    const slug = deriveSellerRouteUsername({
      fullName: "Maya Chen",
      email: "MAYA.CHEN@AlphaTraders.com",
    });

    expect(slug).toBe("maya-chen");
  });

  it("resolves a seller by a normalized username", () => {
    const seller = resolveSellerByUsername(
      [
        { id: "seller-1", fullName: "Maya Chen", email: "maya.chen@example.com", sellerStatus: "approved_seller" },
      ] as Array<{ id: string; fullName: string; email: string; sellerStatus: string }>,
      "maya-chen",
    );

    expect(seller?.id).toBe("seller-1");
  });
});
