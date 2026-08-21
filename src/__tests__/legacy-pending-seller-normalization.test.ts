import { beforeEach, expect, it, vi } from "vitest";
import { hasRole } from "@/lib/roles";
import { getSellerApplicationEligibility } from "@/lib/seller-application-eligibility";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const loadSnapshot = vi.fn();
vi.mock("@/lib/alpha-exchange-repository", () => ({ getAlphaExchangeRepository: vi.fn(async () => ({ loadSnapshot, saveSnapshot: vi.fn() })) }));
import { findUserById, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
beforeEach(() => { invalidateAlphaExchangeStoreCache(); loadSnapshot.mockReset(); });
const base = (user: Record<string, unknown>, applications: unknown[] = []) => ({ users: [user], sellerApplications: applications, marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [] } as unknown as AlphaExchangeDb);
const pending = (userId: string, status = "pending") => ({ id: `app-${userId}`, userId, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const legacy = (id = "edge") => ({ id, email: `${id}@example.test`, fullName: id, role: "pending_seller_approval", roles: ["pending_seller_approval"], sellerStatus: "pending_seller_approval", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

it("restores buyer membership for a persisted legacy pending seller applicant", async () => {
  const now = new Date().toISOString();
  loadSnapshot.mockResolvedValue({ users: [{ id: "legacy", email: "legacy@example.test", fullName: "Legacy", role: "pending_seller_approval", roles: ["pending_seller_approval"], sellerStatus: "pending_seller_approval", createdAt: now, updatedAt: now }], sellerApplications: [{ id: "app", userId: "legacy", status: "pending", createdAt: now, updatedAt: now }], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [] } as unknown as AlphaExchangeDb);
  const user = await findUserById("legacy");
  expect(user?.roles).toEqual(expect.arrayContaining(["buyer", "pending_seller_approval"]));
  expect(hasRole(user!, "buyer")).toBe(true);
  expect(hasRole(user!, "approved_seller")).toBe(false);
  expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: user!, application: { status: "pending" }, applicationSubmitted: false })).toBe("application_pending");
});

it("keeps modern pending membership without duplication", async () => { const u = { ...legacy("modern"), roles: ["buyer", "pending_seller_approval"] }; loadSnapshot.mockResolvedValue(base(u, [pending("modern")])); const r = await findUserById("modern"); expect(r?.roles.filter((x) => x === "buyer")).toHaveLength(1); expect(r?.sellerStatus).toBe("pending_seller_approval"); });
it("does not normalize without a matching pending application", async () => { loadSnapshot.mockResolvedValue(base(legacy())); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("does not normalize another user's application", async () => { loadSnapshot.mockResolvedValue(base(legacy(), [pending("other")])); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("does not normalize rejected applications", async () => { loadSnapshot.mockResolvedValue(base(legacy(), [pending("edge", "rejected")])); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("preserves approved sellers", async () => { const u = { ...legacy("approved"), role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller" }; loadSnapshot.mockResolvedValue(base(u)); const r = await findUserById("approved"); expect(hasRole(r!, "approved_seller")).toBe(true); expect(r?.sellerStatus).toBe("approved_seller"); });
