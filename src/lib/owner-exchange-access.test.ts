import { describe, expect, it } from "vitest";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "./alpha-exchange-identity";
import { canViewOwnerExchangeIdentity } from "./owner-exchange-access";

describe("owner exchange identity capability", () => {
  it.each([{ role: "owner" }, { role: "owner", roles: ["owner", "admin"] }, { role: "admin", roles: ["owner", "admin"] }])("accepts the canonical owner with primary/multiple roles: %j", roles => {
    expect(canViewOwnerExchangeIdentity({ id: "owner", email: ALPHA_EXCHANGE_OWNER_EMAIL, ...roles })).toBe(true);
  });
  it.each([
    { id: "admin", role: "admin", email: "admin@example.test" },
    { id: "buyer", role: "buyer", email: ALPHA_EXCHANGE_OWNER_EMAIL },
    { id: "other", role: "owner", email: "other@example.test" },
    { id: "owner", role: "owner", email: ALPHA_EXCHANGE_OWNER_EMAIL, disabled: true },
    null,
  ])("denies a non-owner, incorrect account, disabled account or missing session: %j", viewer => {
    expect(canViewOwnerExchangeIdentity(viewer)).toBe(false);
  });
});
