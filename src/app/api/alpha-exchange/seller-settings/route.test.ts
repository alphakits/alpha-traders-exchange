// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSellerWorkspaceActor: vi.fn(),
  canPublishListings: vi.fn(),
  addSellerBankAccount: vi.fn(),
  deleteSellerBankAccount: vi.fn(),
  getSellerBankAccountsForUser: vi.fn(),
  updateSellerAvailabilityStatus: vi.fn(),
  updateSellerBankAccount: vi.fn(),
  updateUserSellerSettings: vi.fn(),
  checkSharedRateLimit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSellerWorkspaceActor: mocks.requireApiSellerWorkspaceActor,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  canPublishListings: mocks.canPublishListings,
  addSellerBankAccount: mocks.addSellerBankAccount,
  deleteSellerBankAccount: mocks.deleteSellerBankAccount,
  getSellerBankAccountsForUser: mocks.getSellerBankAccountsForUser,
  updateSellerAvailabilityStatus: mocks.updateSellerAvailabilityStatus,
  updateSellerBankAccount: mocks.updateSellerBankAccount,
  updateUserSellerSettings: mocks.updateUserSellerSettings,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

import { GET, PATCH } from "@/app/api/alpha-exchange/seller-settings/route";

const user = {
  id: "legacy-seller-1",
  role: "approved_seller",
  roles: ["approved_seller"],
  sellerStatus: "approved_seller",
  fullName: "Legacy Seller",
  whatsappNumber: "",
  preferredNetworks: [],
  profilePhotoUrl: "",
  coverBannerUrl: "",
  languages: ["English"],
  bio: "",
  tradingExperience: "",
  workingHours: "",
  preferredPaymentMethods: [],
  country: "Israel",
  city: "",
  onlineStatus: "offline",
  availabilityStatus: "available",
};

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/seller-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("seller settings approval boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSellerWorkspaceActor.mockResolvedValue({ user, unauthorized: null });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getSellerBankAccountsForUser.mockResolvedValue([{ id: "bank-1" }]);
    mocks.addSellerBankAccount.mockResolvedValue({ id: "bank-2" });
  });

  it("does not expose bank accounts when the seller is suspended", async () => {
    mocks.canPublishListings.mockReturnValue(false);
    mocks.requireApiSellerWorkspaceActor.mockResolvedValue({ user: { ...user, sellerStatus: "suspended" }, unauthorized: null });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      bankAccounts: [],
      sellerApprovalVerified: false,
    });
    expect(mocks.getSellerBankAccountsForUser).not.toHaveBeenCalled();
  });

  it("rejects bank-account and availability mutations for a suspended seller", async () => {
    mocks.canPublishListings.mockReturnValue(false);
    mocks.requireApiSellerWorkspaceActor.mockResolvedValue({ user: { ...user, sellerStatus: "suspended" }, unauthorized: null });

    const bankResponse = await PATCH(patchRequest({
      action: "add_bank_account",
      accountHolderName: "Legacy Seller",
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "1234567890",
    }));
    const availabilityResponse = await PATCH(patchRequest({ availabilityStatus: "available" }));

    expect(bankResponse.status).toBe(403);
    expect(availabilityResponse.status).toBe(403);
    expect(mocks.addSellerBankAccount).not.toHaveBeenCalled();
    expect(mocks.updateSellerAvailabilityStatus).not.toHaveBeenCalled();
  });

  it("returns the approved seller compatibility flag without requiring new identity metadata", async () => {
    mocks.canPublishListings.mockReturnValue(true);
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ bankAccounts: [{ id: "bank-1" }], sellerApprovalVerified: true });
    expect(mocks.getSellerBankAccountsForUser).toHaveBeenCalledWith(user.id);
  });

  it("allows an approved seller to manage a payout account without extra identity metadata", async () => {
    mocks.canPublishListings.mockReturnValue(true);

    const response = await PATCH(patchRequest({
      action: "add_bank_account",
      accountHolderName: "Verified Seller",
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "1234567890",
      isDefault: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.addSellerBankAccount).toHaveBeenCalledWith(expect.objectContaining({
      sellerId: user.id,
      actorUserId: user.id,
      accountNumber: "1234567890",
    }));
  });
});
