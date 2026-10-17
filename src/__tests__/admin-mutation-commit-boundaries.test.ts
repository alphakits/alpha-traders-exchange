// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { broadcastNotificationByAdmin, changeUserRoleByAdmin, disableUserAccountByAdmin,
  invalidateAlphaExchangeStoreCache, setSellerVacationModeByAdmin, updateSellerProfileStateByAdmin } from "@/lib/alpha-exchange-store";
import { publishRealtimeEvent } from "@/lib/realtime";

const snapshot = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
const broadcast = { actorUserId: "owner", reason: "Synthetic operational notice", type: "warning" as const,
  titleEn: "Controlled notice", bodyEn: "Synthetic test only", titleAr: "إشعار تجريبي", bodyAr: "اختبار فقط" };
const roleChange = { actorUserId: "owner", userId: "account", role: "admin" as const, reason: "Synthetic role change" };
const changes = [
  { name: "role", run: () => changeUserRoleByAdmin(roleChange), expected: { role: "admin" } },
  { name: "restriction", run: () => disableUserAccountByAdmin({ actorUserId: "owner", userId: "account", disabled: true, reason: "Synthetic restriction" }), expected: { disabled: true } },
  { name: "vacation", run: () => setSellerVacationModeByAdmin({ actorUserId: "owner", userId: "account", enabled: true }), expected: { availabilityStatus: "vacation" } },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(publishRealtimeEvent).mockClear();
  const now = new Date().toISOString();
  const users = ["owner", "account", "other"].map(id => ({ id, fullName: id, email: `${id}@example.test`,
    role: id === "owner" ? "owner" : "buyer", roles: id === "owner" ? ["owner", "admin"] : ["buyer"], sellerStatus: "buyer",
    passwordHash: "old-hash", emailVerified: true, availabilityStatus: "available", createdAt: now, updatedAt: now,
    notificationPreferences: { inApp: true, email: false, sms: false } }) as AlphaExchangeUser);
  globalThis.__alphaExchangeMemorySnapshot = { users, sellerApplications: [], marketplaceListings: [], purchaseRequests: [],
    commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [],
    disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [],
    privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0 } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});

async function beforeCommit(change: (db: AlphaExchangeDb) => void) {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  return vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (incoming, options) => {
    const newer = await repository.loadSnapshot();
    change(newer);
    await persist(newer, { selectedTables: ["users"] });
    await persist(incoming, options);
  });
}

it.each(changes)("$name keeps a password change committed while its save waits", async action => {
  await beforeCommit(db => { db.users.find(user => user.id === "account")!.passwordHash = "new-hash"; });
  await action.run();
  expect(snapshot().users.find(user => user.id === "account")).toMatchObject({ ...action.expected, passwordHash: "new-hash" });
  expect(snapshot().auditLogs).toHaveLength(1);
});

it.each(changes)("$name rejects an actor disabled before commit", async action => {
  await beforeCommit(db => { db.users.find(user => user.id === "owner")!.disabled = true; });
  await expect(action.run()).rejects.toThrow(/access required|access is required/i);
  expect(snapshot().users.find(user => user.id === "account")).toMatchObject({ role: "buyer", availabilityStatus: "available", passwordHash: "old-hash" });
  expect(snapshot().auditLogs).toHaveLength(0);
});

it("refuses to disable an account promoted to owner before commit", async () => {
  await beforeCommit(db => { const user = db.users.find(item => item.id === "account")!; user.role = "owner"; user.roles = ["owner", "admin"]; });
  await expect(disableUserAccountByAdmin({ actorUserId: "owner", userId: "account", disabled: true, reason: "Synthetic restriction" })).rejects.toThrow("Owner account cannot be disabled");
  expect(snapshot().users.find(user => user.id === "account")?.disabled).not.toBe(true);
});

it("rejects non-owner direct account restrictions and blank audit reasons", async () => {
  await expect(disableUserAccountByAdmin({ actorUserId: "other", userId: "account", disabled: true, reason: "Unauthorized" })).rejects.toThrow(/owner access/i);
  await expect(disableUserAccountByAdmin({ actorUserId: "owner", userId: "account", disabled: true, reason: " " })).rejects.toThrow(/reason/i);
  expect(snapshot().auditLogs).toHaveLength(0);
});

it("publishes no broadcast when its write fails, then retries with one durable audit and one notification per user", async () => {
  const repository = await getAlphaExchangeRepository();
  const persist = repository.saveSnapshot.bind(repository);
  let fail = true;
  const writes: string[][] = [];
  vi.spyOn(repository, "saveSnapshot").mockImplementation(async (db, options) => {
    if (options?.selectedTables?.includes("notifications")) {
      writes.push([...options.selectedTables]);
      if (fail) throw new Error("Synthetic broadcast persistence failure");
    }
    await persist(db, options);
  });
  await expect(broadcastNotificationByAdmin(broadcast)).rejects.toThrow("Synthetic broadcast persistence failure");
  expect(vi.mocked(publishRealtimeEvent)).not.toHaveBeenCalled();
  expect(snapshot().notifications).toHaveLength(0);
  expect(snapshot().auditLogs).toHaveLength(0);
  fail = false;
  await broadcastNotificationByAdmin(broadcast);
  expect(writes.every(tables => tables.includes("audit_logs"))).toBe(true);
  expect(snapshot().auditLogs).toHaveLength(1);
  const stored = snapshot().notifications.map(item => item.id).sort();
  const emitted = vi.mocked(publishRealtimeEvent).mock.calls.flatMap(([event]) => event.type === "notification.created" ? [event.payload.notification.id] : []).sort();
  expect(stored).toHaveLength(3);
  expect(emitted).toEqual(stored);
});

it("rejects a broadcast if owner access is revoked while the write waits", async () => {
  await beforeCommit(db => { db.users.find(user => user.id === "owner")!.disabled = true; });
  await expect(broadcastNotificationByAdmin(broadcast)).rejects.toThrow(/owner access/i);
  expect(snapshot().notifications).toHaveLength(0);
  expect(snapshot().auditLogs).toHaveLength(0);
  expect(vi.mocked(publishRealtimeEvent)).not.toHaveBeenCalled();
});

function sellerProfile() {
  const user = snapshot().users.find(user => user.id === "account")!;
  Object.assign(user, { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller",
    isFeaturedSeller: false, isProfileHidden: false,
    sellerApprovalVerification: { method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true,
      liveIdentityVideoReviewed: true, contactOwnershipConfirmed: true, marketplaceRulesAccepted: true,
      verifiedAt: new Date().toISOString(), verifiedByUserId: "owner" } });
}
const profileChange = { sellerId: "account", adminUserId: "owner", feature: true };

it("profile controls preserve a concurrent password change", async () => {
  sellerProfile();
  await beforeCommit(db => { db.users.find(user => user.id === "account")!.passwordHash = "new-hash"; });
  const result = await updateSellerProfileStateByAdmin(profileChange);
  expect(result.passwordHash).toBe("new-hash");
  expect(snapshot().users.find(user => user.id === "account")).toMatchObject({ passwordHash: "new-hash", isFeaturedSeller: true });
});

it("profile controls recheck a disabled actor before commit", async () => {
  sellerProfile();
  await beforeCommit(db => { db.users.find(user => user.id === "owner")!.disabled = true; });
  await expect(updateSellerProfileStateByAdmin(profileChange)).rejects.toThrow(/admin access/i);
  expect(snapshot().auditLogs).toHaveLength(0);
});

it("profile controls protect a target promoted to owner while waiting", async () => {
  sellerProfile();
  await beforeCommit(db => { Object.assign(db.users.find(user => user.id === "account")!, { role: "owner", roles: ["owner"] }); });
  await expect(updateSellerProfileStateByAdmin(profileChange)).rejects.toThrow(/owner account/i);
  expect(snapshot().users.find(user => user.id === "account")?.isFeaturedSeller).toBe(false);
});

it("profile controls recheck seller eligibility before featuring", async () => {
  sellerProfile();
  await beforeCommit(db => { Object.assign(db.users.find(user => user.id === "account")!, { role: "buyer", roles: ["buyer"], sellerStatus: "buyer" }); });
  await expect(updateSellerProfileStateByAdmin(profileChange)).rejects.toThrow(/approved sellers/i);
  expect(snapshot().auditLogs).toHaveLength(0);
});

it("profile controls retain simultaneous visibility and featured changes", async () => {
  sellerProfile();
  await Promise.all([updateSellerProfileStateByAdmin(profileChange),
    updateSellerProfileStateByAdmin({ sellerId: "account", adminUserId: "owner", hidden: true })]);
  expect(snapshot().users.find(user => user.id === "account")).toMatchObject({ isFeaturedSeller: true, isProfileHidden: true });
  expect(snapshot().auditLogs).toHaveLength(2);
});

it("profile controls reject a non-admin service caller", async () => {
  sellerProfile();
  await expect(updateSellerProfileStateByAdmin({ ...profileChange, adminUserId: "other" })).rejects.toThrow(/admin access/i);
  expect(snapshot().auditLogs).toHaveLength(0);
});
