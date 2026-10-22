// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, TradeEvidenceFile } from "@/types/alpha-exchange";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
import { archiveReadNotifications, deleteNotification, getAuditLogsForAdmin, invalidateAlphaExchangeStoreCache, markAllNotificationsRead, markNotificationReadState, updateNotificationState } from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository, type SnapshotTableName } from "@/lib/alpha-exchange-repository";
import { publishRealtimeEvent } from "@/lib/realtime";

const USER_ID = "notification-reader";
const OTHER_USER_ID = "notification-other-user";

function user(id: string): AlphaExchangeUser {
  const now = "2026-09-05T10:00:00.000Z";
  return {
    id,
    fullName: id,
    email: `${id}@example.test`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    isFoundingMember: false,
    isFoundingSeller: false,
    emailVerified: true,
    emailVerifiedAt: now,
    onboardingSelection: "buyer",
    onboardingCompletedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const createdAt = "2026-09-05T10:00:00.000Z";
  return {
    users: [user(USER_ID), user(OTHER_USER_ID)],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [
      {
        id: "notification-one",
        userId: USER_ID,
        category: "account",
        title: "First update",
        message: "First persistent update.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "notification-two",
        userId: USER_ID,
        category: "system",
        title: "Second update",
        message: "Second persistent update.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "notification-other",
        userId: OTHER_USER_ID,
        category: "account",
        title: "Other user update",
        message: "This must not be changed.",
        isRead: false,
        state: "unread",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}


const readTables = ["users", "seller_applications", "listings", "purchase_requests", "commissions", "notifications", "activity_logs", "disputes", "trust_snapshots"] satisfies SnapshotTableName[];
function snapshot() { return globalThis.__alphaExchangeMemorySnapshot as unknown as ReturnType<typeof seedDb>; }
const operations = [
  { name: "mark one read", run: () => markNotificationReadState({ userId: USER_ID, notificationId: "notification-one", isRead: true }) },
  { name: "archive one", run: () => updateNotificationState({ userId: USER_ID, notificationId: "notification-one", state: "archived" }) },
  { name: "mark all read", run: () => markAllNotificationsRead(USER_ID) },
  { name: "archive read", run: () => archiveReadNotifications(USER_ID) },
  { name: "delete one", run: () => deleteNotification({ userId: USER_ID, notificationId: "notification-one" }) },
];

describe("notification mutation scope and durable publication", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemorySnapshot!.notifications[1].state = "read";
    globalThis.__alphaExchangeMemorySnapshot!.notifications[1].isRead = true;
    globalThis.__alphaExchangeMemoryEvidenceContent = new Map() as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    vi.mocked(publishRealtimeEvent).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); invalidateAlphaExchangeStoreCache(); });

  it.each(operations)("$name avoids unrelated full-store work and declares complete canonical rebase dependencies", async ({ run }) => {
    const repository = await getAlphaExchangeRepository();
    // The compatibility repository keeps a full in-memory snapshot. The
    // production contract is the declared SQL table set, checked below.
    const selected = vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(snapshot()) as never);
    const full = vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Unrelated full snapshot unavailable"));
    const save = vi.spyOn(repository, "saveSnapshot");
    const otherBefore = structuredClone(snapshot().notifications.find(item => item.userId === OTHER_USER_ID));
    await run();
    expect(full).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledExactlyOnceWith(readTables);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toEqual(expect.objectContaining({
      selectedTables: ["notifications"], rebaseTables: readTables, rebaseOnLatest: expect.any(Function),
    }));
    // Normalization may enrich presentation fields; every original recipient,
    // content, read state, and timestamp must remain unchanged.
    expect(snapshot().notifications.find(item => item.userId === OTHER_USER_ID)).toMatchObject(otherBefore!);
    // A scoped write cannot become the complete store cache. The next whole
    // store reader must reach the repository instead of returning that snapshot.
    full.mockResolvedValue(structuredClone(snapshot()) as never);
    await getAuditLogsForAdmin();
    expect(full).toHaveBeenCalledTimes(1);
  });

  it.each(operations)("$name publishes only after commit and preserves concurrent receipt/account history", async ({ run }) => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(snapshot()) as never);
    const originalSave = repository.saveSnapshot.bind(repository);
    const bytes = Buffer.from("retained exact receipt bytes");
    const receipt: TradeEvidenceFile = {
      id: "concurrent-receipt",
      purchaseRequestId: "concurrent-trade",
      side: "buyer",
      uploadedByUserId: USER_ID,
      uploadedAt: "2026-10-22T00:00:00Z",
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      storagePath: "db://concurrent-receipt",
      status: "uploaded",
    };
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (db, options) => {
      expect(publishRealtimeEvent).not.toHaveBeenCalled();
      snapshot().notifications.push({ ...snapshot().notifications[0], id: "concurrent-other", userId: OTHER_USER_ID, message: "Concurrent update", state: "unread", isRead: false });
      snapshot().tradeEvidenceFiles.push(receipt);
      globalThis.__alphaExchangeMemoryEvidenceContent!.set("concurrent-receipt", bytes);
      snapshot().authSessions.push({ userId: USER_ID, token: "retained-session", createdAt: "2026-10-22T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" });
      snapshot().__runtimeVersion += 1;
      await originalSave(db, options);
    });
    await run();
    expect(snapshot().notifications.find(item => item.id === "concurrent-other")).toMatchObject({ message: "Concurrent update", state: "unread" });
    expect(snapshot().tradeEvidenceFiles).toContainEqual(receipt);
    expect(globalThis.__alphaExchangeMemoryEvidenceContent!.get("concurrent-receipt")).toEqual(bytes);
    expect(snapshot().authSessions).toContainEqual(expect.objectContaining({ token: "retained-session" }));
    expect(publishRealtimeEvent).toHaveBeenCalled();
  });

  it.each(operations)("$name leaves state and publication unchanged if the durable commit fails", async ({ run }) => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(snapshot()) as never);
    const before = structuredClone(snapshot());
    vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("Durable commit rejected"));
    await expect(run()).rejects.toThrow("Durable commit rejected");
    expect(snapshot()).toEqual(before);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
    const full = vi.spyOn(repository, "loadSnapshot").mockResolvedValue(structuredClone(snapshot()) as never);
    invalidateAlphaExchangeStoreCache();
    await getAuditLogsForAdmin();
    expect(full).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "state", "delete"])("denies another recipient's notification for %s", async operation => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(snapshot()) as never);
    const save = vi.spyOn(repository, "saveSnapshot");
    const args = { userId: USER_ID, notificationId: "notification-other" };
    const action = operation === "read" ? markNotificationReadState({ ...args, isRead: true })
      : operation === "state" ? updateNotificationState({ ...args, state: "archived" }) : deleteNotification(args);
    await expect(action).rejects.toThrow("Notification not found");
    expect(save).not.toHaveBeenCalled();
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("does not write or publish for empty mark-all/archive operations", async () => {
    snapshot().notifications = snapshot().notifications.filter(item => item.userId === OTHER_USER_ID);
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "loadSelectedSnapshot").mockImplementation(async () => structuredClone(snapshot()) as never);
    const save = vi.spyOn(repository, "saveSnapshot");
    await markAllNotificationsRead(USER_ID);
    await archiveReadNotifications(USER_ID);
    expect(save).not.toHaveBeenCalled();
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });
});
