import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

import {
  createAuthSession,
  deleteSessionByToken,
  getAccountProfileData,
  getAuthenticatedUserBySessionToken,
  invalidateAlphaExchangeStoreCache,
  updateAccountProfileData,
  upsertUserProfileForAuth,
} from "@/lib/alpha-exchange-store";
import { needsBuyerContact } from "@/lib/buyer-contact";
import { toAdminUserSummary, toClientSessionUser } from "@/lib/client-session-user";
import { toMobileAccountProfile } from "@/lib/mobile-account-profile";

const USER_ID = "private-contact-buyer";
const EMAIL = "private-contact@example.test";
const SAVED_PHONE = "+972501234567";
const NEXT_PHONE = "+40722123456";

function seed() {
  const now = new Date().toISOString();
  const user = {
    id: USER_ID, email: EMAIL, fullName: "Contact Buyer", passwordHash: "",
    whatsappNumber: "", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
    emailVerified: true, onlineStatus: "offline", availabilityStatus: "available",
    preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "",
    createdAt: now, updatedAt: now,
  } satisfies AlphaExchangeUser;
  return {
    users: [user], sellerApplications: [], marketplaceListings: [], purchaseRequests: [],
    commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [],
    notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [],
    trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 0,
  } satisfies AlphaExchangeDb & { __runtimeVersion: number };
}

function coldStart() {
  invalidateAlphaExchangeStoreCache();
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
}

beforeEach(() => {
  globalThis.__alphaExchangeMemorySnapshot = seed() as never;
  coldStart();
});
afterEach(() => {
  coldStart();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
});

describe("private contact persistence across authentication", () => {
  it.each(["5201", "+972509876543", "", "   "])(
    "keeps a saved contact through five cold login/logout cycles with provider value %j",
    async (providerPhone) => {
      await updateAccountProfileData({ userId: USER_ID, whatsappNumber: "٠٥٠١٢٣٤٥٦٧" });
      for (let cycle = 0; cycle < 5; cycle++) {
        coldStart();
        const synced = await upsertUserProfileForAuth({
          email: EMAIL, fullName: "Old Provider Name", whatsappNumber: providerPhone, emailVerified: true,
        });
        expect(synced.whatsappNumber).toBe(SAVED_PHONE);
        const token = `private-contact-session-${cycle}`;
        await createAuthSession(USER_ID, token);
        coldStart();
        const authenticated = await getAuthenticatedUserBySessionToken(token);
        expect(authenticated?.whatsappNumber).toBe(SAVED_PHONE);
        const sessionUser = toClientSessionUser(authenticated);
        expect(sessionUser?.whatsappNumber).toBe(SAVED_PHONE);
        expect(needsBuyerContact(sessionUser)).toBe(false);
        const { profile } = await getAccountProfileData(USER_ID);
        expect(profile.whatsappNumber).toBe(SAVED_PHONE);
        expect(toMobileAccountProfile(profile).whatsappNumber).toBe(SAVED_PHONE);
        expect(toAdminUserSummary(authenticated!, true).whatsappNumber).toBe(SAVED_PHONE);
        expect(toAdminUserSummary(authenticated!).whatsappNumber).toBe("");
        await deleteSessionByToken(token);
        coldStart();
        expect(await getAuthenticatedUserBySessionToken(token)).toBeNull();
        expect((await getAccountProfileData(USER_ID)).profile.whatsappNumber).toBe(SAVED_PHONE);
      }
    },
  );

  it("keeps an explicit contact change when the old valid number returns from authentication", async () => {
    await updateAccountProfileData({ userId: USER_ID, whatsappNumber: SAVED_PHONE });
    await updateAccountProfileData({ userId: USER_ID, whatsappNumber: NEXT_PHONE });
    coldStart();
    const synced = await upsertUserProfileForAuth({ email: EMAIL, fullName: "Contact Buyer", whatsappNumber: SAVED_PHONE });
    expect(synced.whatsappNumber).toBe(NEXT_PHONE);
    coldStart();
    expect((await getAccountProfileData(USER_ID)).profile.whatsappNumber).toBe(NEXT_PHONE);
  });

  it.each(["", "5201"])("bootstraps a valid provider number when the saved contact is %j", async (savedPhone) => {
    globalThis.__alphaExchangeMemorySnapshot!.users[0].whatsappNumber = savedPhone;
    const synced = await upsertUserProfileForAuth({ email: EMAIL, fullName: "Contact Buyer", whatsappNumber: "٠٥٠١٢٣٤٥٦٧" });
    expect(synced.whatsappNumber).toBe(SAVED_PHONE);
    coldStart();
    expect((await getAccountProfileData(USER_ID)).profile.whatsappNumber).toBe(SAVED_PHONE);
    expect(needsBuyerContact(toClientSessionUser(synced))).toBe(false);
  });

  it("still requires a contact when neither the profile nor provider has a valid number", async () => {
    const synced = await upsertUserProfileForAuth({ email: EMAIL, fullName: "Contact Buyer", whatsappNumber: "5201" });
    expect(synced.whatsappNumber).toBe("");
    expect(needsBuyerContact(toClientSessionUser(synced))).toBe(true);
    await expect(updateAccountProfileData({ userId: USER_ID, whatsappNumber: "5201" })).rejects.toMatchObject({ code: "PRIVATE_CONTACT_REQUIRED" });
  });

  it.each([true, false])("preserves a contact save overlapping an auth update (save first: %j)", async (saveFirst) => {
    globalThis.__alphaExchangeMemorySnapshot!.users[0].emailVerified = false;
    const save = () => updateAccountProfileData({ userId: USER_ID, whatsappNumber: SAVED_PHONE });
    const login = () => upsertUserProfileForAuth({ email: EMAIL, fullName: "Contact Buyer", whatsappNumber: "5201", emailVerified: true });
    await Promise.all(saveFirst ? [save(), login()] : [login(), save()]);
    coldStart();
    expect((await getAccountProfileData(USER_ID)).profile.whatsappNumber).toBe(SAVED_PHONE);
    await createAuthSession(USER_ID, "overlapping-auth-session");
    expect(await getAuthenticatedUserBySessionToken("overlapping-auth-session")).toMatchObject({ whatsappNumber: SAVED_PHONE, emailVerified: true });
  });
});
