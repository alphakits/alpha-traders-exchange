import { describe, expect, it } from "vitest";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import {
  deriveSellerRouteUsername,
  resolveSellerByUsername,
  resolveSellerListingPaymentMethods,
} from "@/lib/alpha-exchange-seller-profile";

type SellerIdentity = Pick<AlphaExchangeUser, "id" | "fullName" | "email" | "sellerStatus" | "buyerDisplayName">;

describe("seller profile route helpers", () => {
  it("derives a stable anonymous route that ignores personal trading names", () => {
    const slug = deriveSellerRouteUsername({
      id: "seller-1",
      fullName: "Maya Chen",
      email: "MAYA.CHEN@AlphaTraders.com",
      publicTradingName: "Maya OTC",
    });

    expect(slug).toBe(deriveSellerRouteUsername({ id: "seller-1" }));
    expect(slug).not.toContain("maya");
  });

  it("resolves a seller by a normalized username", () => {
    const seller = resolveSellerByUsername(
      [
        { id: "seller-1", fullName: "Maya Chen", email: "maya.chen@example.com", sellerStatus: "approved_seller", buyerDisplayName: "Maya OTC" },
      ] satisfies SellerIdentity[],
      deriveSellerRouteUsername({ id: "seller-1" }),
    );

    expect(seller?.id).toBe("seller-1");
  });

  it("does not resolve historical personal-name or email slugs", () => {
    const identity: SellerIdentity = {
      id: "seller-2",
      fullName: "Mark",
      email: "marksally11@yahoo.com",
      sellerStatus: "approved_seller",
    };

    expect(deriveSellerRouteUsername(identity)).toBe("seller-c41022b2");
    expect(resolveSellerByUsername([identity], "seller-c41022b2")?.id).toBe(identity.id);
    expect(resolveSellerByUsername([identity], "marksally11")).toBeUndefined();
    expect(resolveSellerByUsername([identity], "mark")).toBeUndefined();
  });

  it("keeps every active-listing payment method visible on the public seller profile", () => {
    expect(resolveSellerListingPaymentMethods({
      paymentMethod: "Bank Transfer",
      paymentMethods: [
        "Bank Transfer",
        "Face-to-Face (Meet in Person)",
        "Cardless ATM Withdrawal",
      ],
    })).toEqual([
      "Bank Transfer",
      "Face-to-Face (Meet in Person)",
      "Cardless ATM Withdrawal",
    ]);

    expect(resolveSellerListingPaymentMethods({
      paymentMethod: "تحويل بنكي",
      paymentMethods: ["تحويل بنكي", "سحب من الصراف دون بطاقة"],
    })).toEqual(["Bank Transfer", "Cardless ATM Withdrawal"]);
  });
});
