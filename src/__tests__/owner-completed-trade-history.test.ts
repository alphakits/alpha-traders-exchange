import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, PurchaseRequest, TradeChatMessage, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));

import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { downloadTradeEvidenceContent, getTradeEvidenceForRequest, getTradeRoomData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publishRealtimeEvent } from "@/lib/realtime";
import { publicAccountId } from "@/lib/public-account-identity";

const CREATED_AT = "2026-09-23T08:00:00.000Z";
const UPDATED_AT = "2026-09-23T09:00:00.000Z";
const REQUEST_ID = "completed-history-trade";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";

function user(id: string, role: UserRole, fullName: string): AlphaExchangeUser {
  return {
    id, role, roles: [role], fullName, email: `${id}@example.test`, passwordHash: "hash",
    whatsappNumber: "+972501234567", sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    createdAt: CREATED_AT, updatedAt: CREATED_AT, emailVerified: true, onlineStatus: "online",
    availabilityStatus: "available", preferredNetworks: ["TRC20"], languages: ["English"],
    bio: "", profilePhotoUrl: "", sellerPrestigeRank: "bronze", lifetimeCompletedVolumeUsdt: 0,
  } as AlphaExchangeUser;
}

function seed(status: PurchaseRequest["status"] = "completed") {
  const messages = Array.from({ length: 125 }, (_, index): TradeChatMessage => ({
    id: `message-${index}`, purchaseRequestId: REQUEST_ID, kind: index % 3 === 0 ? "system" : "user",
    senderUserId: index % 2 === 0 ? "buyer" : "seller", senderRole: index % 2 === 0 ? "buyer" : "approved_seller",
    message: index === 0 ? "Amir Hassan paid Maya Chen" : `Trade message ${index}`,
    createdAt: new Date(Date.parse(CREATED_AT) + index * 1000).toISOString(), readByUserIds: [],
    ...(index === 50 ? { imageUrl: `data:image/png;base64,${PNG}`, imageMimeType: "image/png", imageName: "proof.png" } : {}),
  }));
  const trade: PurchaseRequest = {
    id: REQUEST_ID, tradeId: "TR-HISTORY", buyerId: "buyer", sellerId: "seller", listingId: "deleted-listing",
    buyerName: "Amir Hassan", usdtAmount: "100", pricePerUsdt: "3.20", fiatAmount: "320", currency: "ILS",
    network: "TRC20", paymentMethod: "Bank Transfer", status, createdAt: CREATED_AT, updatedAt: UPDATED_AT,
    completedAt: UPDATED_AT, lockedAt: UPDATED_AT, messages: messages.reverse(),
    timeline: [{ id: "completed-event", type: "trade_completed", actorUserId: "seller", actorRole: "approved_seller", message: "Maya Chen completed the trade", createdAt: UPDATED_AT }],
    buyerReview: { reviewerUserId: "buyer", rating: 5, comment: "Received successfully", createdAt: UPDATED_AT },
  };
  const evidence = {
    id: "evidence-current", purchaseRequestId: REQUEST_ID, side: "buyer" as const, uploadedByUserId: "buyer",
    uploadedAt: UPDATED_AT, fileName: "receipt.png", mimeType: "image/png" as const,
    sizeBytes: Buffer.from(PNG, "base64").length, storagePath: "db://evidence-current", status: "uploaded" as const,
  };
  return {
    users: [user("owner", "owner", "Mark Owner"), user("buyer", "buyer", "Amir Hassan"), user("seller", "approved_seller", "Maya Chen"), user("outsider", "buyer", "Other Member"), user("admin", "admin", "Moderator")],
    marketplaceListings: [], purchaseRequests: [trade], sellerApplications: [], commissionRecords: [],
    auditLogs: [{ id: "audit-completed", action: "purchase_completed", actorUserId: "seller", purchaseRequestId: REQUEST_ID, details: "Completion recorded", createdAt: UPDATED_AT }],
    authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [],
    disputes: [{ id: "resolved-dispute", tradeId: "TR-HISTORY", purchaseRequestId: REQUEST_ID, openedByUserId: "buyer", buyerId: "buyer", sellerId: "seller", reason: "Transfer delayed", status: "resolved", resolutionNotes: "Received", createdAt: CREATED_AT, updatedAt: UPDATED_AT }],
    sellerReports: [], trustSnapshots: [], trustScoreHistory: [],
    tradeEvidenceFiles: [evidence, { ...evidence, id: "evidence-replaced", status: "replaced", uploadedAt: CREATED_AT }],
    privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0,
  } as AlphaExchangeDb & { __runtimeVersion: number };
}

function install(db = seed()) {
  globalThis.__alphaExchangeMemorySnapshot = db as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
}

beforeEach(() => { vi.clearAllMocks(); install(); });
afterEach(() => {
  vi.restoreAllMocks(); invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
});

describe("owner completed Trade Room history", () => {
  it.each(["completed", "locked", "review_open"] as const)("loads every persisted record at %s without changing the trade", async status => {
    install(seed(status));
    const repository = await getAlphaExchangeRepository();
    const snapshotBefore = structuredClone(globalThis.__alphaExchangeMemorySnapshot);
    const write = vi.spyOn(repository, "saveSnapshot");
    const focusedWrite = vi.spyOn(repository, "mutateFocusedTrade");
    const room = await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "buyer", ownerHistory: true, strongConsistency: true, markMessagesRead: true });

    expect(room.request).toMatchObject({ status, completedAt: UPDATED_AT, lockedAt: UPDATED_AT, buyerReview: { rating: 5 } });
    expect(room.listing).toBeNull();
    expect(room.messages).toHaveLength(125);
    expect(room.messages[0]).toMatchObject({ id: "message-0", message: "Amir Hassan paid Maya Chen", readByUserIds: [] });
    expect(room.messages.at(-1)?.id).toBe("message-124");
    expect(room.messages[50].imageUrl).toBe(`data:image/png;base64,${PNG}`);
    expect(room.request.timeline[0].message).toBe("Maya Chen completed the trade");
    expect(room.ownerHistory?.evidenceFiles.map(item => item.id)).toEqual(["evidence-replaced", "evidence-current"]);
    expect(room.ownerHistory?.disputes[0].resolutionNotes).toBe("Received");
    expect(room.ownerHistory?.auditLogs[0].id).toBe("audit-completed");
    expect(write).not.toHaveBeenCalled();
    expect(focusedWrite).not.toHaveBeenCalled();
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
    expect(globalThis.__alphaExchangeMemorySnapshot).toEqual(snapshotBefore);
  });

  it("does not mark chat read when the owner is also a trade participant", async () => {
    const db = seed("review_open");
    db.purchaseRequests[0].sellerId = "owner";
    install(db);
    const before = structuredClone(globalThis.__alphaExchangeMemorySnapshot);
    await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "owner", ownerHistory: true, strongConsistency: true, markMessagesRead: true });
    expect(globalThis.__alphaExchangeMemorySnapshot).toEqual(before);
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("resolves stored AT identities in historical chat for the owner", async () => {
    const db = seed();
    db.purchaseRequests[0].messages![0].message = `${publicAccountId(db.users[1])} paid ${publicAccountId(db.users[2])}`;
    install(db);
    const room = await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "owner", ownerHistory: true });
    expect(room.messages.at(-1)?.message).toBe("Amir Hassan paid Maya Chen");
  });

  it("retains the saved buyer name for the owner when an old buyer account is absent, while peers remain private", async () => {
    const db = seed();
    db.users = db.users.filter(item => item.id !== "buyer");
    install(db);
    const room = await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "owner", ownerHistory: true });
    expect(room.counterpart.buyerName).toBe("Amir Hassan");
    expect(room.request.buyerName).toBe("Amir Hassan");
    const peerRoom = await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "seller", actorRole: "approved_seller", markMessagesRead: false });
    expect(JSON.stringify(peerRoom)).not.toContain("Amir Hassan");
  });

  it("lets the canonical owner open historical evidence while leaving settlement untouched", async () => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "readEvidenceContent").mockResolvedValue(Buffer.from(PNG, "base64"));
    const requestBefore = structuredClone((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).purchaseRequests[0]);
    const evidence = await getTradeEvidenceForRequest({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "buyer" });
    expect(evidence.buyerEvidence?.id).toBe("evidence-current");
    const downloaded = await downloadTradeEvidenceContent({ evidenceId: "evidence-replaced", actorUserId: "owner", actorRole: "buyer" });
    expect(downloaded.buffer.equals(Buffer.from(PNG, "base64"))).toBe(true);
    expect(downloaded.request.status).toBe("completed");
    expect((globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb).purchaseRequests[0]).toMatchObject(requestBefore);
  });

  it.each(["buyer", "seller", "outsider", "admin", "missing-user"])("denies owner history to %s even with a supplied owner role", async actorUserId => {
    await expect(getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId, actorRole: "owner", ownerHistory: true, strongConsistency: true }))
      .rejects.toThrow("You are not allowed to access trade history.");
  });

  it("denies disabled owner history and forged roles on ordinary room/evidence reads", async () => {
    const db = seed();
    db.users[0].disabled = true;
    install(db);
    await expect(getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "owner", actorRole: "owner", ownerHistory: true, strongConsistency: true })).rejects.toThrow("You are not allowed to access trade history.");
    for (const actorRole of ["owner", "admin"] as const) {
      await expect(getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "outsider", actorRole, strongConsistency: true })).rejects.toThrow("You are not allowed to access trade evidence.");
      await expect(getTradeEvidenceForRequest({ purchaseRequestId: REQUEST_ID, actorUserId: "outsider", actorRole })).rejects.toThrow("You are not allowed to access trade evidence.");
      await expect(downloadTradeEvidenceContent({ evidenceId: "evidence-current", actorUserId: "outsider", actorRole })).rejects.toThrow("You are not allowed to access trade evidence.");
    }
  });

  it("keeps peer identities private and excludes owner history from ordinary room responses", async () => {
    const db = seed();
    const room = await getTradeRoomData({ purchaseRequestId: REQUEST_ID, actorUserId: "seller", actorRole: "owner", markMessagesRead: false, strongConsistency: true });
    expect(room.counterpart).toEqual({ buyerName: publicAccountId(db.users[1]), sellerName: publicAccountId(db.users[2]) });
    expect(room).not.toHaveProperty("ownerHistory");
    expect(JSON.stringify(room)).not.toMatch(/Amir Hassan|Maya Chen/);
    expect(room.messages).toHaveLength(125);
  });
});
