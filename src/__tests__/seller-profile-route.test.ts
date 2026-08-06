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

  it("preserves the email-derived canonical username while resolving legacy full-name routes", () => {
    const identity = {
      id: "seller-2",
      fullName: "Mark",
      email: "marksally11@yahoo.com",
      sellerStatus: "approved_seller",
    };

    expect(deriveSellerRouteUsername(identity)).toBe("marksally11");
    expect(resolveSellerByUsername([identity], "marksally11")?.id).toBe(identity.id);
    expect(resolveSellerByUsername([identity], "mark")?.id).toBe(identity.id);
  });
});
