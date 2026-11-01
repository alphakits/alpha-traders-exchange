// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemand, changeDemand, readDemandWorkspace, respondToDemand } from "@/lib/usdt-demand-engine";
import { commitDemandMatch, demandState, validateDemandMatch } from "@/lib/usdt-demand-policy";
import { getWiseUsdAccountFingerprint } from "@/lib/wise-bank-transfer";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import type { DemandTerms } from "@/types/usdt-demand";
import type { WiseUsdAccount, WiseUsdAccountDetails } from "@/types/wise";

let db = demandTestDb();

function wiseTerms(): DemandTerms {
  return { ...demandTestTerms(), currency: "USD", bankTransferProvider: "wise", price: "1.01" };
}

function reviewedAccount(userId: string): WiseUsdAccount {
  const details: WiseUsdAccountDetails = {
    provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal",
    accountHolderName: `Private ${userId}`, bankName: "Synthetic Test Bank",
    routingNumber: "019999995", accountNumber: "000123456789", accountType: "checking",
  };
  return {
    ...details, id: `wise-${userId}`, userId,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ownershipReview: {
      status: "manually_reviewed", method: "document_review", reviewedBy: "independent-test-reviewer",
      reviewedAt: new Date().toISOString(), evidenceReference: "private-synthetic-review-document",
      verifiedAccountHolderName: details.accountHolderName,
      accountFingerprint: getWiseUsdAccountFingerprint(details),
    },
  };
}

function publish(terms = wiseTerms(), operationId = randomUUID()) {
  return createDemand(db, "buyer", { terms, operationId }, demandTestMarket());
}

function offer(demandId: string, price = "1.02") {
  return respondToDemand(db, "seller", demandId, {
    listingId: "listing-seller", revision: 1, price, operationId: randomUUID(),
  }, demandTestMarket());
}

function preparedMatch() {
  const demand = publish();
  const response = offer(demand.id);
  const input = {
    buyerId: "buyer", demandId: demand.id, offerId: response.id, revision: demand.revision,
    listingId: response.listingId, amount: demand.amount, paymentMethod: demand.paymentMethod,
    network: demand.network, currency: "USD", bankTransferProvider: "wise",
  };
  const trade = {
    id: "synthetic-wise-match", buyerId: "buyer", sellerId: "seller", listingId: response.listingId,
    status: "pending", usdtAmount: demand.amount, pricePerUsdt: response.price,
    feePolicyVersion: "buyer_seller_1pct_v1", currency: "USD", bankTransferProvider: "wise",
  } as PurchaseRequest;
  return { demand, response, input, trade };
}

beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "1");
  vi.stubEnv("ALPHA_EXCHANGE_DATA_BACKEND", "json");
  vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SUPABASE_DB_URL", "");
  vi.stubGlobal("__alphaTradersRuntimeDbPool", undefined);
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_PROJECT_ID", "");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  db = demandTestDb();
  const seller = db.users.find(user => user.id === "seller")!;
  seller.wiseUsdAccounts = [reviewedAccount(seller.id)];
  Object.assign(db.marketplaceListings[0], {
    currency: "USD", price: "1.01", bankTransferProvider: "wise", wiseAccountId: `wise-${seller.id}`,
  });
  delete db.marketplaceListings[0].bankAccountId;
  delete db.marketplaceListings[0].bankName;
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("USD Wise buy-request terms", () => {
  it("creates explicit USD terms and does not apply the unrelated ILS price band", () => {
    const demand = publish();
    expect(demand).toMatchObject({ currency: "USD", bankTransferProvider: "wise", price: "1.01", city: "" });
    expect(demandState(db, demand, demandTestMarket(10, 120_001))).toBe("open");
    const workspace = readDemandWorkspace(db, "buyer", demandTestMarket(), { id: demand.id });
    expect(workspace.wiseDraftEnabled).toBe(true);
    expect(workspace.requests[0]).toMatchObject({ currency: "USD", bankTransferProvider: "wise" });
    expect(db.notifications.every(notice => notice.message.includes("USD 1.01") && !notice.message.includes("₪"))).toBe(true);
  });

  it.each([
    { currency: "EUR" }, { currency: "ILS" }, { currency: undefined },
    { bankTransferProvider: "israeli_bank" }, { bankTransferProvider: undefined },
    { paymentMethod: "Cardless ATM Withdrawal" },
    { paymentMethod: "Face-to-Face (Meet in Person)", city: "Haifa" },
    { price: "0" }, { price: "-1.00" }, { price: "1.001" },
  ])("rejects incompatible or invalid Wise terms %j", (overrides) => {
    expect(() => createDemand(db, "buyer", { terms: { ...wiseTerms(), ...overrides }, operationId: randomUUID() }, demandTestMarket())).toThrow();
    expect(db.usdtDemands).toHaveLength(0);
    expect(db.notifications).toHaveLength(0);
  });

  it("rejects a transaction-purpose field instead of persisting it", () => {
    expect(() => createDemand(db, "buyer", {
      terms: { ...wiseTerms(), transactionPurpose: "synthetic-purpose" }, operationId: randomUUID(),
    }, demandTestMarket())).toThrow();
    expect(db.usdtDemands).toHaveLength(0);
  });

  it("replays a submission without duplicating requests or notifications", () => {
    const operationId = randomUUID();
    const first = publish(wiseTerms(), operationId);
    const noticeCount = db.notifications.length;
    expect(publish(wiseTerms(), operationId)).toBe(first);
    expect(db.usdtDemands).toHaveLength(1);
    expect(db.notifications).toHaveLength(noticeCount);
  });

  it("binds idempotency to currency and provider even when the numeric price is unchanged", () => {
    const operationId = randomUUID();
    publish({ ...wiseTerms(), price: "3.20" }, operationId);
    expect(() => publish(demandTestTerms(), operationId)).toThrow(/key/);
    expect(db.usdtDemands![0]).toMatchObject({ currency: "USD", bankTransferProvider: "wise" });
  });

  it("clears Wise currency/provider when editing back to legacy bank transfer", () => {
    const demand = publish();
    const response = offer(demand.id);
    const expiresAt = demand.expiresAt;
    changeDemand(db, "buyer", demand.id, { action: "edit", revision: 1, terms: demandTestTerms() }, demandTestMarket());
    expect(demand).not.toHaveProperty("currency");
    expect(demand).not.toHaveProperty("bankTransferProvider");
    expect(demand).toMatchObject({ price: "3.20", revision: 2, expiresAt });
    expect(response.state).toBe("superseded");
    expect(demand.createTerms).toMatchObject({ currency: "USD", bankTransferProvider: "wise" });
  });

  it("treats a provider/currency-only edit as a real revision", () => {
    const demand = publish({ ...wiseTerms(), price: "3.20" });
    changeDemand(db, "buyer", demand.id, { action: "edit", revision: 1, terms: demandTestTerms() }, demandTestMarket());
    expect(demand.revision).toBe(2);
    changeDemand(db, "buyer", demand.id, { action: "edit", revision: 2, terms: { ...wiseTerms(), price: "3.20" } }, demandTestMarket());
    expect(demand).toMatchObject({ revision: 3, currency: "USD", bankTransferProvider: "wise" });
  });
});

describe("Wise offer and match binding", () => {
  it("selects only a USD Wise seller listing and preserves the offered USD price", () => {
    const { demand, response, input } = preparedMatch();
    expect(response.price).toBe("1.02");
    expect(validateDemandMatch(db, input, demandTestMarket()).offer.id).toBe(response.id);
    expect(readDemandWorkspace(db, "seller", demandTestMarket(), { id: demand.id }).listings.map(listing => listing.id)).toEqual(["listing-seller"]);
    expect(readDemandWorkspace(db, "seller-two", demandTestMarket(), { id: demand.id }).listings).toEqual([]);
  });

  it.each([
    { currency: "ILS" }, { currency: undefined },
    { bankTransferProvider: "israeli_bank" }, { bankTransferProvider: undefined },
    { paymentMethod: "Cardless ATM Withdrawal" },
  ])("rejects mismatched selected trade terms %j", (overrides) => {
    const { input } = preparedMatch();
    expect(() => validateDemandMatch(db, { ...input, ...overrides }, demandTestMarket())).toThrow(/Review/);
  });

  it.each([{ currency: "ILS" }, { bankTransferProvider: "israeli_bank" }, { bankTransferProvider: undefined }] as const)(
    "refuses a changed listing route %j", (overrides) => {
      const { input } = preparedMatch();
      Object.assign(db.marketplaceListings[0], overrides);
      expect(() => validateDemandMatch(db, input, demandTestMarket())).toThrow();
    },
  );

  it("makes an offer unavailable when seller ownership review is revoked", () => {
    const { demand, input } = preparedMatch();
    db.users.find(user => user.id === "seller")!.wiseUsdAccounts![0].ownershipReview = { status: "pending_review" };
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: demand.id }).requests[0].offers[0].available).toBe(false);
    expect(() => validateDemandMatch(db, input, demandTestMarket())).toThrow();
  });

  it("makes an offer unavailable when the seller platform identity no longer matches the reviewed account", () => {
    const { demand, input } = preparedMatch();
    db.users.find(user => user.id === "seller")!.fullName = "Different Synthetic Identity";
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: demand.id }).requests[0].offers[0].available).toBe(false);
    expect(() => validateDemandMatch(db, input, demandTestMarket())).toThrow(/platform identity/);
  });

  it("keeps bank details, review evidence and raw account IDs out of the demand workspace", () => {
    const { demand } = preparedMatch();
    const serialized = JSON.stringify(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: demand.id }));
    expect(serialized).not.toMatch(/019999995|000123456789|private-synthetic-review-document|wise-seller|accountFingerprint|ownershipReview/);
  });

  it("commits the matching USD Wise trade once and locks later acceptance", () => {
    const { demand, response, input, trade } = preparedMatch();
    commitDemandMatch(db, input, demandTestMarket(), trade);
    expect(demand).toMatchObject({ state: "matched", purchaseRequestId: trade.id, acceptedOfferId: response.id });
    expect(response.state).toBe("accepted");
    expect(() => commitDemandMatch(db, input, demandTestMarket(), trade)).toThrow(/changed or closed/);
    expect(demand.history.filter(entry => entry.action === "matched")).toHaveLength(1);
  });

  it.each([{ currency: "ILS" }, { bankTransferProvider: "israeli_bank" }, { bankTransferProvider: undefined }] as const)(
    "rejects a trade record whose currency/provider differs from the validated input: %j", (overrides) => {
      const { demand, response, input, trade } = preparedMatch();
      expect(() => commitDemandMatch(db, input, demandTestMarket(), { ...trade, ...overrides })).toThrow();
      expect(demand.state).toBe("open");
      expect(response.state).toBe("open");
    },
  );
});

describe("Wise buy-request capability gate", () => {
  it.each([
    ["ALPHA_WISE_DRAFT_ENABLED", "0"],
    ["ALPHA_EXCHANGE_DATA_BACKEND", "postgres"],
    ["ALPHA_EXCHANGE_DATA_BACKEND", "supabase"],
    ["ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "0"],
    ["DATABASE_URL", "synthetic-test-database-setting"],
    ["SUPABASE_DB_URL", "synthetic-test-database-setting"],
    ["VERCEL_ENV", "production"],
  ])("blocks new Wise requests when %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => publish()).toThrow(/unavailable/);
    expect(db.usdtDemands).toHaveLength(0);
    expect(readDemandWorkspace(db, "buyer", demandTestMarket())).not.toHaveProperty("wiseDraftEnabled");
  });

  it("pauses existing unmatched Wise requests and rejects acceptance after disabling", () => {
    const { demand, input } = preparedMatch();
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    expect(demandState(db, demand, demandTestMarket())).toBe("paused");
    expect(() => validateDemandMatch(db, input, demandTestMarket())).toThrow(/unavailable/);
    expect(demand.state).toBe("open");
  });

  it("keeps legacy ILS requests usable with Wise disabled", () => {
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    const demand = publish(demandTestTerms());
    expect(demandState(db, demand, demandTestMarket())).toBe("open");
    expect(demand).not.toHaveProperty("currency");
    expect(demand).not.toHaveProperty("bankTransferProvider");
  });
});
