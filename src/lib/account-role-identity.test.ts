import { describe, expect, it } from "vitest";
import { accountRoleIdentity } from "./account-role-identity";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "./alpha-exchange-identity";
import type { ClientSessionUser } from "./client-session-user";

const buyer = { role: "buyer", email: "buyer@example.test", sellerStatus: "buyer" } satisfies Pick<ClientSessionUser, "role" | "email" | "sellerStatus">;

describe("account welcome identity", () => {
  it("keeps owner identity ahead of seller approval for both canonical and legacy sessions", () => {
    expect(accountRoleIdentity({ ...buyer, role: "owner", sellerStatus: "approved_seller", sellerApprovalVerified: true })).toBe("owner");
    expect(accountRoleIdentity({ ...buyer, role: "admin", email: ALPHA_EXCHANGE_OWNER_EMAIL })).toBe("owner");
    expect(accountRoleIdentity({ ...buyer, roles: ["owner", "approved_seller"] })).toBe("owner");
  });
  it("follows canonical seller status rather than stale role labels", () => {
    expect(accountRoleIdentity({ ...buyer, role: "approved_seller", sellerStatus: "suspended", sellerApprovalVerified: true })).not.toBe("approved_seller");
    expect(accountRoleIdentity({ ...buyer, role: "approved_seller", sellerStatus: "pending_seller_approval", sellerApprovalVerified: true })).toBe("pending_seller");
    expect(accountRoleIdentity({ ...buyer, role: "approved_seller", sellerStatus: "approved_seller", sellerApprovalVerified: false })).toBe("approved_seller");
    expect(accountRoleIdentity({ ...buyer, role: "approved_seller", sellerStatus: "approved_seller", sellerApprovalVerified: true })).toBe("approved_seller");
  });
  it("preserves distinct member identities", () => {
    expect(accountRoleIdentity(buyer)).toBe("buyer");
    expect(accountRoleIdentity({ ...buyer, role: "student" })).toBe("student");
    expect(accountRoleIdentity({ ...buyer, role: "admin" })).toBe("administrator");
    expect(accountRoleIdentity({ ...buyer, sellerStatus: "pending_seller_approval" })).toBe("pending_seller");
  });
});
