import { describe, expect, it } from "vitest";
import { identityTextRedactor, publicAccountId } from "./public-account-identity";
import { formatBuyerId, formatSellerId } from "./format-id";

describe("AT account identities", () => {
  it("uses the dashboard identifier, including sellers purchasing as buyers", () => {
    expect(publicAccountId({ id: "one", role: "buyer" })).toBe(formatBuyerId(undefined, "one"));
    for (const sellerStatus of ["approved_seller", "suspended"]) expect(publicAccountId({ id: "one", role: "buyer", sellerStatus })).toBe(formatSellerId(undefined, "one"));
    expect(publicAccountId({ id: "one", role: "approved_seller", sellerStatus: "buyer" })).toBe(formatBuyerId(undefined, "one"));
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
