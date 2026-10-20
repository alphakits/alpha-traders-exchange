import { describe, expect, it } from "vitest";
import { compactSnapshotIdentities, getSnapshotIdentityUsers, preserveSnapshotIdentityDirectory, setSnapshotIdentityDirectory } from "./alpha-exchange-identity-directory";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "./alpha-exchange-identity";
import { identityTextRedactor } from "./public-account-identity";

describe("private snapshot identity directory", () => {
  it("keeps memory identities compact and recognizes canonical legacy owner aliases", () => {
    const users = [{ id: "legacy-owner", fullName: "Legacy Owner", role: "buyer", email: ` ${ALPHA_EXCHANGE_OWNER_EMAIL.toUpperCase()} `,
      passwordHash: "private-password", sellerBankAccounts: [{ accountNumber: "private-bank" }] }];
    const identities = compactSnapshotIdentities(users);
    expect(identities[0]).toMatchObject({ id: "legacy-owner", fullName: "Legacy Owner", role: "owner" });
    expect(JSON.stringify(identities)).not.toMatch(/private-password|private-bank|email|sellerBankAccounts/);
    expect(identityTextRedactor(identities)("Legacy Owner")).toBe("Legacy Owner");
    const snapshot = { users };
    setSnapshotIdentityDirectory(snapshot, identities);
    expect(identityTextRedactor(getSnapshotIdentityUsers(snapshot))("Legacy Owner")).toBe("Legacy Owner");
    expect(snapshot.users[0].role).toBe("buyer");
  });

  it("preserves masking through normalization without publishing identities or granting authority", () => {
    const snapshot = { users: [{ id: "seller", fullName: "Trade Seller", role: "buyer" }] };
    const hiddenMember = { id: "unrelated", fullName: "Maya Chen", buyerDisplayName: "Maya OTC", role: "buyer" };
    setSnapshotIdentityDirectory(snapshot, [snapshot.users[0], hiddenMember]);
    const normalized = { ...snapshot, users: [{ ...snapshot.users[0], role: "owner" }] };
    preserveSnapshotIdentityDirectory(snapshot, normalized);
    const identities = getSnapshotIdentityUsers(normalized);
    expect(identityTextRedactor(identities)("Trade Seller / Maya Chen")).toMatch(/^Trade Seller \/ AT-\d+$/);
    expect(normalized.users).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/Maya|unrelated|identit/i);
    expect(JSON.stringify(normalized)).not.toMatch(/Maya|unrelated|identit/i);
  });

  it("keeps directories isolated and falls back to the snapshot's users when no context exists", () => {
    const scoped = { users: [{ id: "seller", fullName: "Trade Seller" }] };
    const ordinary = { users: [{ id: "buyer", fullName: "Ordinary Buyer" }] };
    setSnapshotIdentityDirectory(scoped, [{ id: "unrelated", fullName: "Maya Chen" }]);
    expect(getSnapshotIdentityUsers(ordinary)).toBe(ordinary.users);
    expect(getSnapshotIdentityUsers(ordinary)).not.toContainEqual({ id: "unrelated", fullName: "Maya Chen" });
    preserveSnapshotIdentityDirectory(ordinary, { ...ordinary });
    expect(getSnapshotIdentityUsers(scoped)).toEqual([{ id: "unrelated", fullName: "Maya Chen" }]);
  });
});
