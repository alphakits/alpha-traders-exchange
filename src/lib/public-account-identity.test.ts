import { describe, expect, it } from "vitest";
import { identityTextRedactor, publicAccountId, publicAccountName, ownerIdentityText, accountNameForViewer } from "./public-account-identity";
import { formatBuyerId, formatSellerId, formatDisplayId, normalizePublicAccountId } from "./format-id";

describe("AT account identities", () => {
  it("keeps the owner public and resolves members' AT IDs only in an owner view", () => {
    const owner = { id: "owner", fullName: "Alex Morgan", role: "owner" };
    const buyer = { id: "buyer", fullName: "Amir Hassan", role: "buyer" };
    expect(publicAccountName(owner)).toBe("Alex Morgan");
    expect(publicAccountName(buyer)).toBe(publicAccountId(buyer));
    expect(accountNameForViewer(buyer, owner)).toBe("Amir Hassan");
    expect(accountNameForViewer(buyer, { id: "admin", role: "admin" })).toBe(publicAccountId(buyer));
    expect(identityTextRedactor([owner, buyer], true)("Alex Morgan met Amir Hassan")).toBe(`Alex Morgan met ${publicAccountId(buyer)}`);
    expect(ownerIdentityText([owner, buyer])(`${publicAccountId(buyer)} sent a request`)).toBe("Amir Hassan sent a request");
  });
  it("uses the dashboard identifier, including sellers purchasing as buyers", () => {
    expect(publicAccountId({ id: "one", role: "buyer" })).toBe(formatBuyerId(undefined, "one"));
    for (const sellerStatus of ["approved_seller", "suspended"]) expect(publicAccountId({ id: "one", role: "buyer", sellerStatus })).toBe(formatSellerId(undefined, "one"));
    expect(publicAccountId({ id: "one", role: "approved_seller", sellerStatus: "buyer" })).toBe(formatBuyerId(undefined, "one"));
  });
  it("retains the number and owner-only historical name resolution when labels change", () => {
    const buyer = { id: "legacy-buyer", fullName: "Amir Hassan", role: "buyer" };
    const oldBuyer = formatDisplayId("buyer", undefined, buyer.id);
    const oldSeller = formatDisplayId("seller", undefined, buyer.id);
    expect(publicAccountId(buyer)).toBe(oldBuyer.replace("#B-", "AT-"));
    expect(publicAccountId({ ...buyer, role: "approved_seller" })).toBe(publicAccountId(buyer));
    expect(identityTextRedactor([buyer])(`${oldBuyer} / ${oldSeller}`)).toBe(`${publicAccountId(buyer)} / ${publicAccountId(buyer)}`);
    expect(ownerIdentityText([buyer])(`${oldBuyer} / ${oldSeller}`)).toBe("Amir Hassan / Amir Hassan");
    expect(normalizePublicAccountId("Amir Hassan")).toBeUndefined();
    expect(normalizePublicAccountId("AT-000001")).toBe("AT-000001");
  });
  it("removes real names, custom aliases and contact information from historical English and Arabic text", () => {
    const users = [{ id: "seller", sellerStatus: "approved_seller", fullName: "Maya Chen", buyerDisplayName: "Maya OTC" }, { id: "buyer", fullName: "أحمد علي" }];
    const redact = identityTextRedactor(users, true);
    const text = redact("Maya Chen / Maya OTC / Chen / أحمد علي / أحمد: +972501234567 maya@example.test. 38000 USDT at 3.20 ILS.");
    expect(text).not.toMatch(/Maya|Chen|OTC|أحمد|علي|1234567|example/);
    expect(text).toContain(publicAccountId(users[0]));
    expect(text).toContain(publicAccountId(users[1]));
    expect(text).toContain("38000 USDT at 3.20 ILS");
    expect(redact(text)).toBe(text);
  });
});
