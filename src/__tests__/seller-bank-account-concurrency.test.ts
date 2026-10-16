// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, SellerBankAccount } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { addSellerBankAccount, deleteSellerBankAccount, invalidateAlphaExchangeStoreCache, updateSellerBankAccount } from "@/lib/alpha-exchange-store";

const current = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
const details = { accountHolderName: "Controlled Seller", bankName: "Synthetic Bank", branchNumber: "123", accountNumber: "1234567890" };
const input = { ...details, sellerId: "seller", actorUserId: "seller" };
function account(id: string): SellerBankAccount {
  const now = new Date().toISOString();
  return { ...input, id, accountLast4: "7890", isDefault: id === "bank-1", createdAt: now, updatedAt: now };
}
const actions = [
  { name: "add", run: (actorUserId = "seller") => addSellerBankAccount({ ...input, actorUserId }) },
  { name: "update", run: (actorUserId = "seller") => updateSellerBankAccount({ ...input, actorUserId, bankAccountId: "bank-1", bankName: "Changed Bank" }) },
  { name: "delete", run: (actorUserId = "seller") => deleteSellerBankAccount({ ...input, actorUserId, bankAccountId: "bank-1" }) },
] as const;
beforeEach(() => {
  const now = new Date().toISOString();
  globalThis.__alphaExchangeMemorySnapshot = { users: [{ id: "seller", fullName: "Controlled Seller", email: "seller@example.test",
    role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", passwordHash: "old-password", emailVerified: true,
    sellerApprovalVerification: { method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true, liveIdentityVideoReviewed: true,
      contactOwnershipConfirmed: true, marketplaceRulesAccepted: true, verifiedAt: now, verifiedByUserId: "owner" },
    createdAt: now, updatedAt: now, sellerBankAccounts: [account("bank-1")], notificationPreferences: { inApp: false, email: false, sms: false } }],
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [],
    sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0 } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => vi.restoreAllMocks());

async function whileWaiting(change: (db: AlphaExchangeDb) => void) {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const latest = await repository.loadSnapshot();
    change(latest);
    await persist(latest, { selectedTables: ["users", "listings", "purchase_requests"] });
    await persist(incoming, options);
  });
}

it.each(actions)("bank $name preserves a password change committed while waiting", async action => {
  await whileWaiting(db => { db.users[0].passwordHash = "new-password"; });
  await action.run();
  expect(current().users[0].passwordHash).toBe("new-password");
  expect(current().auditLogs).toHaveLength(1);
});

it.each(actions)("bank $name rejects an account disabled before commit", async action => {
  await whileWaiting(db => { db.users[0].disabled = true; });
  await expect(action.run()).rejects.toThrow(/restricted|disabled/i);
  expect(current().users[0].disabled).toBe(true);
  expect(current().users[0].sellerBankAccounts).toEqual([account("bank-1")].map(a => expect.objectContaining({ id: a.id, bankName: a.bankName })));
  expect(current().auditLogs).toHaveLength(0);
});

it.each(actions)("bank $name rejects another actor at the service boundary", async action => {
  await expect(action.run("outsider")).rejects.toThrow(/own|allowed|access/i);
  expect(current().auditLogs).toHaveLength(0);
});

it.each(actions)("bank $name rechecks seller access before commit", async action => {
  await whileWaiting(db => { Object.assign(db.users[0], { role: "buyer", roles: ["buyer"], sellerStatus: "buyer", sellerApprovalVerification: undefined }); });
  await expect(action.run()).rejects.toThrow(/approval|seller access/i);
  expect(current().users[0].role).toBe("buyer");
  expect(current().auditLogs).toHaveLength(0);
});

it("allows only one concurrent addition when one bank-account slot remains", async () => {
  const results = await Promise.allSettled([actions[0].run(), actions[0].run()]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(current().users[0].sellerBankAccounts).toHaveLength(2);
  expect(current().auditLogs).toHaveLength(1);
});

it("preserves two concurrent additions and exactly one default", async () => {
  current().users[0].sellerBankAccounts = [];
  const added = await Promise.all([actions[0].run(), actions[0].run()]);
  expect(current().users[0].sellerBankAccounts?.map(a => a.id).sort()).toEqual(added.map(a => a.id).sort());
  expect(current().users[0].sellerBankAccounts?.filter(a => a.isDefault)).toHaveLength(1);
  expect(current().auditLogs).toHaveLength(2);
});

it.each(["trade", "listing"])("rejects deletion when a linked %s starts while waiting", async kind => {
  await whileWaiting(db => {
    if (kind === "trade") db.purchaseRequests.push({ id: "request", sellerId: "seller", sellerBankAccountId: "bank-1", status: "accepted" } as never);
    else db.marketplaceListings.push({ id: "listing", sellerId: "seller", bankAccountId: "bank-1", status: "active" } as never);
  });
  await expect(actions[2].run()).rejects.toThrow(/linked to active/);
  expect(current().users[0].sellerBankAccounts?.[0].id).toBe("bank-1");
  expect(current().auditLogs).toHaveLength(0);
});

it("rejects changed payment details when a linked trade starts while waiting", async () => {
  await whileWaiting(db => { db.purchaseRequests.push({ id: "request", sellerId: "seller", sellerBankAccountId: "bank-1", status: "accepted" } as never); });
  await expect(actions[1].run()).rejects.toThrow(/locked to an active trade/);
  expect(current().users[0].sellerBankAccounts?.[0].bankName).toBe(details.bankName);
  expect(current().auditLogs).toHaveLength(0);
});

it("preserves independent concurrent edits to both bank accounts", async () => {
  current().users[0].sellerBankAccounts = [account("bank-1"), account("bank-2")];
  await Promise.all([actions[1].run(), updateSellerBankAccount({ ...input, bankAccountId: "bank-2", branchNumber: "456" })]);
  expect(current().users[0].sellerBankAccounts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "bank-1", bankName: "Changed Bank" }),
    expect.objectContaining({ id: "bank-2", branchNumber: "456" }),
  ]));
  expect(current().auditLogs).toHaveLength(2);
});
