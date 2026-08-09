import { describe, expect, it } from "vitest";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { deriveSellerRouteUsername, resolveSellerByUsername } from "@/lib/alpha-exchange-seller-profile";

type SellerIdentity = Pick<AlphaExchangeUser, "id" | "fullName" | "email" | "sellerStatus" | "buyerDisplayName">;

describe("seller profile route helpers", () => {
  it("derives a route username from an explicit public trading name", () => {
    const slug = deriveSellerRouteUsername({
      fullName: "Maya Chen",
      email: "MAYA.CHEN@AlphaTraders.com",
      publicTradingName: "Maya OTC",
    });

    expect(slug).toBe("maya-otc");
  });

  it("resolves a seller by a normalized username", () => {
    const seller = resolveSellerByUsername(
      [
        { id: "seller-1", fullName: "Maya Chen", email: "maya.chen@example.com", sellerStatus: "approved_seller", buyerDisplayName: "Maya OTC" },
      ] satisfies SellerIdentity[],
      "maya-otc",
    );

    expect(seller?.id).toBe("seller-1");
  });

  it("uses privacy-safe canonical slugs while preserving legacy route resolution", () => {
    const identity: SellerIdentity = {
      id: "seller-2",
      fullName: "Mark",
      email: "marksally11@yahoo.com",
      sellerStatus: "approved_seller",
    };

    expect(deriveSellerRouteUsername(identity)).toBe("seller-c41022b2");
    expect(resolveSellerByUsername([identity], "seller-c41022b2")?.id).toBe(identity.id);
    expect(resolveSellerByUsername([identity], "marksally11")?.id).toBe(identity.id);
    expect(resolveSellerByUsername([identity], "mark")?.id).toBe(identity.id);
  });
});
