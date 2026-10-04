import { describe, expect, it } from "vitest";
import { canShowInterfaceLink, getInterfaceAccess, getInterfacePageDestination } from "@alpha-traders/contracts";
import { signedInEntryDestination } from "./signed-in-entry-destination";

describe("shared interface access", () => {
  it.each(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"])("never offers sign-in or registration to a signed-in %s", (role) => {
    const user = { role, roles: [role], sellerStatus: role };
    expect(canShowInterfaceLink("/login", user)).toBe(false);
    expect(canShowInterfaceLink("/ar/register?intent=learn", user)).toBe(false);
    expect(canShowInterfaceLink("/profile", user)).toBe(true);
    expect(canShowInterfaceLink("/admin/discord", user)).toBe(role === "owner" || role === "admin");
  });
  it("uses canonical approval status and keeps suspended sellers able to settle", () => {
    const suspended = { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "suspended" };
    expect(getInterfaceAccess(suspended).canSell).toBe(false);
    expect(canShowInterfaceLink("/dashboard/seller/compliance-payment", suspended)).toBe(true);
    expect(getInterfacePageDestination(suspended, "/en/dashboard/seller/compliance-payment", "en")).toBeNull();
    const revoked = { ...suspended, sellerStatus: "rejected" };
    expect(getInterfaceAccess(revoked).sellerWorkspace).toBe(false);
    expect(canShowInterfaceLink("/usdt-exchange?mode=sell#create-listing", revoked)).toBe(false);
  });
  it.each(["guest", "student"])("keeps %s out of buyer dashboards and private seller/admin routes", (role) => {
    const user = { role, roles: [role] };
    expect(getInterfacePageDestination(user, "/ar/dashboard", "ar")).toBe("/ar/profile");
    expect(getInterfacePageDestination(user, "/ar/dashboard/seller", "ar")).toBe("/ar/profile");
    expect(getInterfacePageDestination(user, "/ar/admin/alpha-exchange", "ar")).toBe("/ar/profile");
    expect(canShowInterfaceLink("/trades", user)).toBe(false);
  });
  it("respects combined roles, pending applications and owner access without an admin label", () => {
    expect(getInterfaceAccess({ role: "student", roles: ["student", "buyer"] }).buyer).toBe(true);
    expect(getInterfaceAccess({ role: "pending_seller_approval", sellerStatus: "pending_seller_approval", roles: ["buyer"] }).canApplyToSell).toBe(false);
    expect(getInterfaceAccess({ role: "owner", roles: ["owner"] }).administration).toBe(true);
  });
  it("preserves safe locale and fragment destinations for already signed-in users", () => {
    const buyer = { role: "buyer", roles: ["buyer"], sellerStatus: "buyer" };
    expect(signedInEntryDestination("ar", buyer, "/en/usdt-exchange?mode=buy#marketplace-sellers")).toBe("/ar/usdt-exchange?mode=buy#marketplace-sellers");
    expect(signedInEntryDestination("en", buyer, "/admin/alpha-exchange")).toBe("/en/dashboard");
    for (const invalid of ["//example.test", "/\\example.test", "/en/login", "/ar/register?intent=learn", "/\nexample.test"]) {
      expect(signedInEntryDestination("en", buyer, invalid)).toBe("/en/dashboard");
    }
    expect(signedInEntryDestination("en", { role: "guest", roles: ["guest"] })).toBe("/en/onboarding");
    expect(signedInEntryDestination("en", { role: "guest", roles: ["guest"], onboardingSelection: "guest" })).toBe("/en/profile");
  });
});
