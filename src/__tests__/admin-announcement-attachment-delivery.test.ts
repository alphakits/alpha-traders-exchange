// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser, UserRole } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("@/lib/admin-announcement-email", async (original) => ({
  ...await original<typeof import("@/lib/admin-announcement-email")>(),
  sendAdminAnnouncementBatch: vi.fn(),
  sendAdminAnnouncementEmail: vi.fn(),
}));

import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import {
  createAdminAnnouncementRun,
  deliverAdminAnnouncementBatch,
  getAdminAnnouncementOverview,
  invalidateAlphaExchangeStoreCache,
  sendAdminAnnouncementTest,
} from "@/lib/alpha-exchange-store";
import { composeAdminAnnouncementEmailContent, sendAdminAnnouncementBatch, sendAdminAnnouncementEmail } from "@/lib/admin-announcement-email";
import { validateAdminAnnouncementAttachment } from "@/lib/admin-announcement-attachment";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

const content = composeAdminAnnouncementEmailContent({
  ar: { subject: "دليل البائع وقواعد البيع", title: "دليل البائع", content: "مرحبًا، اقرأ دليل البائع المرفق قبل بدء البيع.", ctaText: "افتح حسابك" },
  en: { subject: "Seller guide and rules", title: "Seller guide", content: "Hello, read the attached seller guide before selling.", ctaText: "Open your account" },
  ctaUrl: "https://www.alphatraders.co.il/profile",
});
const attachmentInput = {
  filename: "Seller-Guide-and-Rules.pdf",
  contentType: "application/pdf",
  contentBase64: Buffer.from("%PDF-1.4\nSynthetic test fixture only.\n%%EOF\n").toString("base64"),
  sizeBytes: 1,
  sha256: "untrusted-client-value",
};
const requestKey = "11111111-1111-4111-8111-111111111111";
const snapshot = () => globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;

function account(id: string, email: string, role: UserRole): AlphaExchangeUser {
  const timestamp = new Date().toISOString();
  return {
    id, fullName: id, email, role, roles: role === "owner" ? ["owner", "admin"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    ...(role === "approved_seller" ? { sellerApprovalVerification: createTestSellerApprovalVerification() } : {}),
    passwordHash: "", whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "",
    emailVerified: true, availabilityStatus: "available", onlineStatus: "offline", createdAt: timestamp, updatedAt: timestamp,
    notificationPreferences: { inApp: true, email: false, sms: false },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(sendAdminAnnouncementBatch).mockReset().mockImplementation(async input => ({
    ok: true,
    deliveries: input.recipients.map(recipient => ({ userId: recipient.userId, providerEmailId: `provider-${recipient.userId}` })),
    attempts: 1, retryCount: 0, lastAttemptAt: new Date().toISOString(),
  }));
  vi.mocked(sendAdminAnnouncementEmail).mockReset().mockResolvedValue({ ok: true, attempts: 1, retryCount: 0, lastAttemptAt: new Date().toISOString(), providerEmailId: "test-provider-id", retryAfterMs: undefined });
  globalThis.__alphaExchangeMemorySnapshot = {
    users: [
      account("owner", "owner@alphatraders.co.il", "owner"),
      account("admin", "admin@alphatraders.co.il", "admin"),
      account("buyer", "buyer@alphatraders.co.il", "buyer"),
      account("seller-a", "seller-a@alphatraders.co.il", "approved_seller"),
      account("seller-b", "seller-b@alphatraders.co.il", "approved_seller"),
      account("internal", "seller@staff.local", "approved_seller"),
      account("reserved", "seller@example.com", "approved_seller"),
    ],
    sellerApplications: [], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [],
    authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [],
    trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [],
    marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0,
  } as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  invalidateAlphaExchangeStoreCache();
});

function createAttachedRun(overrides: Partial<Parameters<typeof createAdminAnnouncementRun>[0]> = {}) {
  return createAdminAnnouncementRun({ adminUserId: "owner", requestKey, audience: "approved_sellers", expectedRecipientCount: 2, content, attachment: attachmentInput, ...overrides });
}

describe("private PDF announcement campaigns", () => {
  it("keeps preview count, frozen eligible recipients and independently resumable PDF batches aligned", async () => {
    expect((await getAdminAnnouncementOverview("approved_sellers")).recipientCount).toBe(4);
    expect((await getAdminAnnouncementOverview("approved_sellers", { attachment: true })).recipientCount).toBe(2);
    const run = await createAttachedRun();
    expect(run.recipients.map(item => [item.userId, item.batchIndex])).toEqual([["seller-a", 0], ["seller-b", 1]]);
    expect(run.attachment).toEqual(validateAdminAnnouncementAttachment(attachmentInput));
    expect(snapshot().adminAnnouncementRuns[0].attachment).toEqual(run.attachment);
    expect(JSON.stringify(snapshot().auditLogs)).not.toContain(attachmentInput.contentBase64);
    expect(vi.mocked(sendAdminAnnouncementBatch)).not.toHaveBeenCalled();
  });

  it("requires the owner and approved-seller audience at the business layer", async () => {
    await expect(createAttachedRun({ adminUserId: "admin" })).rejects.toThrow("Owner access required");
    await expect(createAttachedRun({ audience: "all_verified_users" })).rejects.toThrow("only be sent to approved sellers");
    await expect(createAttachedRun({ expectedRecipientCount: 4 })).rejects.toThrow("Recipient count changed");
    await expect(createAttachedRun({ attachment: { filename: "missing.pdf" } })).rejects.toThrow();
    expect(snapshot().adminAnnouncementRuns).toHaveLength(0);
  });

  it("does not replace a queued attachment when an idempotency key is reused", async () => {
    const first = await createAttachedRun();
    expect((await createAttachedRun()).id).toBe(first.id);
    await expect(createAttachedRun({ attachment: undefined })).rejects.toThrow("different attachment");
    await expect(createAttachedRun({ attachment: { ...attachmentInput, contentBase64: Buffer.from("%PDF-1.4\nDifferent synthetic fixture.\n%%EOF\n").toString("base64") } })).rejects.toThrow("different attachment");
    expect(snapshot().adminAnnouncementRuns).toHaveLength(1);
    expect(snapshot().adminAnnouncementRuns[0].attachment).toEqual(first.attachment);
  });

  it("rejects another administrator reusing an owner PDF run key without its attachment", async () => {
    await createAttachedRun();
    const original = structuredClone(snapshot().adminAnnouncementRuns);
    await expect(createAdminAnnouncementRun({
      adminUserId: "admin", requestKey, audience: "approved_sellers", expectedRecipientCount: 4, content,
    })).rejects.toThrow("already in use by another administrator");
    expect(snapshot().adminAnnouncementRuns).toEqual(original);
    expect(snapshot().auditLogs).toHaveLength(1);
    expect(sendAdminAnnouncementBatch).not.toHaveBeenCalled();
  });

  it.each(["subject", "title", "content", "ctaText", "ctaUrl"] as const)("rejects a changed %s with the same PDF and request key", async field => {
    const first = await createAttachedRun();
    const changedContent = { ...content, [field]: field === "ctaUrl" ? "https://www.alphatraders.co.il/trades" : content[field] + " Changed" };
    await expect(createAttachedRun({ content: changedContent })).rejects.toThrow("different attachment or message");
    expect(snapshot().adminAnnouncementRuns).toHaveLength(1);
    expect(snapshot().adminAnnouncementRuns[0][field]).toBe(first[field]);
  });

  it("sends and commits each recipient separately, then resumes without resending successes", async () => {
    const run = await createAttachedRun();
    await expect(deliverAdminAnnouncementBatch({ adminUserId: "admin", announcementId: run.id })).rejects.toThrow("Owner access required");
    const first = await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    expect(first).toMatchObject({ successCount: 1, failureCount: 0 });
    expect(first.finishedAt).toBeUndefined();
    expect(snapshot().adminAnnouncementRuns[0].recipients.map(item => item.status)).toEqual(["sent", "pending"]);
    invalidateAlphaExchangeStoreCache();
    const second = await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    expect(second).toMatchObject({ status: "completed", successCount: 2, failureCount: 0 });
    await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    const calls = vi.mocked(sendAdminAnnouncementBatch).mock.calls.map(([input]) => input);
    expect(calls).toHaveLength(2);
    expect(calls.map(input => input.recipients.map(recipient => recipient.userId))).toEqual([["seller-a"], ["seller-b"]]);
    expect(calls.map(input => input.idempotencyKey)).toEqual([`${run.id}-batch-0`, `${run.id}-batch-1`]);
    expect(calls.every(input => input.attachment?.sha256 === run.attachment?.sha256)).toBe(true);
  });

  it.each(["disabled", "unverified", "role-revoked", "email-changed", "internal-domain"])("rechecks %s before delivery and continues to the next approved seller", async change => {
    const run = await createAttachedRun();
    const seller = snapshot().users.find(item => item.id === "seller-a")!;
    if (change === "disabled") seller.disabled = true;
    if (change === "unverified") seller.emailVerified = false;
    if (change === "role-revoked") { seller.role = "buyer"; seller.roles = ["buyer"]; seller.sellerStatus = "buyer"; seller.sellerApprovalVerification = undefined; }
    if (change === "email-changed") seller.email = "changed@alphatraders.co.il";
    if (change === "internal-domain") seller.email = "changed@internal.local";
    const first = await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    expect(sendAdminAnnouncementBatch).not.toHaveBeenCalled();
    expect(first.recipients[0]).toMatchObject({ status: "failed", failureReason: "announcement_attachment_recipient_ineligible", attemptCount: 0 });
    expect(first.batchLockId).toBeUndefined();
    const finished = await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    expect(finished).toMatchObject({ status: "partial_failure", successCount: 1, failureCount: 1 });
    expect(sendAdminAnnouncementBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAdminAnnouncementBatch).mock.calls[0][0].recipients).toEqual([{ userId: "seller-b", email: "seller-b@alphatraders.co.il" }]);
  });

  it("checks eligibility again after the durable delivery lock is acquired", async () => {
    const run = await createAttachedRun();
    const repository = await getAlphaExchangeRepository();
    const lock = repository.acquireAdminAnnouncementBatchLock.bind(repository);
    vi.spyOn(repository, "acquireAdminAnnouncementBatchLock").mockImplementationOnce(async input => {
      const acquired = await lock(input);
      snapshot().users.find(item => item.id === "seller-a")!.disabled = true;
      return acquired;
    });
    const result = await deliverAdminAnnouncementBatch({ adminUserId: "owner", announcementId: run.id });
    expect(result.recipients[0].status).toBe("failed");
    expect(sendAdminAnnouncementBatch).not.toHaveBeenCalled();
  });

  it("keeps PDF test messages inside the same owner and approved-seller boundary", async () => {
    const input = { adminUserId: "owner", recipientEmail: "seller-a@alphatraders.co.il", content, attachment: attachmentInput };
    await expect(sendAdminAnnouncementTest({ ...input, adminUserId: "admin" })).rejects.toThrow("Owner access required");
    await expect(sendAdminAnnouncementTest({ ...input, recipientEmail: "buyer@alphatraders.co.il" })).rejects.toThrow("approved seller");
    await expect(sendAdminAnnouncementTest({ ...input, recipientEmail: "seller@staff.local" })).rejects.toThrow("public email domain");
    expect(sendAdminAnnouncementEmail).not.toHaveBeenCalled();
    await sendAdminAnnouncementTest(input);
    expect(sendAdminAnnouncementEmail).toHaveBeenCalledTimes(1);
    expect(sendAdminAnnouncementEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "seller-a@alphatraders.co.il", attachment: validateAdminAnnouncementAttachment(attachmentInput) }));
  });
});
