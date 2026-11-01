// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WiseUsdAccount, WiseUsdAccountDetails } from "../types/wise";
import {
  createWiseUsdAccountSnapshot,
  getWiseUsdAccountFingerprint,
  isValidAchRoutingNumber,
  isValidWiseUsdAccountNumber,
  isWiseBankTransfer,
  isWiseDraftEnabled,
  isWiseOwnershipReviewed,
  maskWiseUsdAccount,
  normalizeWiseUsdAccountInput,
  parseWiseUsdAccountDetails,
} from "./wise-bank-transfer";

// Entirely synthetic fixtures: passing the checksum does not establish a real bank account.
const DETAILS: WiseUsdAccountDetails = {
  provider: "wise",
  currency: "USD",
  countryCode: "US",
  accountHolderType: "personal",
  accountHolderName: "Example Test Person",
  bankName: "Synthetic Test Bank",
  routingNumber: "019999995",
  accountNumber: "000123456789",
  accountType: "checking",
};

function account(): WiseUsdAccount {
  return {
    ...DETAILS,
    id: "wise-test-account",
    userId: "test-owner",
    createdAt: "2026-10-25T12:00:00.000Z",
    updatedAt: "2026-10-25T12:00:00.000Z",
    ownershipReview: {
      status: "manually_reviewed",
      method: "document_review",
      reviewedAt: "2026-10-25T12:01:00.000Z",
      reviewedBy: "test-reviewer",
      evidenceReference: "private-test-document-reference",
      verifiedAccountHolderName: DETAILS.accountHolderName,
      accountFingerprint: getWiseUsdAccountFingerprint(DETAILS),
    },
  };
}

function routingWithPrefix(prefix: string): string {
  const firstEight = `${prefix}999999`;
  const digits = [...firstEight].map(Number);
  const sum = 3 * (digits[0] + digits[3] + digits[6])
    + 7 * (digits[1] + digits[4] + digits[7]) + digits[2] + digits[5];
  return `${firstEight}${(10 - sum % 10) % 10}`;
}

beforeEach(() => vi.stubGlobal("__alphaTradersRuntimeDbPool", undefined));
afterEach(() => vi.unstubAllGlobals());

describe("Wise USD account input", () => {
  it("accepts synthetic USD ACH instructions without changing leading zeroes", () => {
    expect(parseWiseUsdAccountDetails(DETAILS)).toEqual({ success: true, data: DETAILS });
  });

  it("trims only outer whitespace and discards client-controlled metadata", () => {
    const parsed = parseWiseUsdAccountDetails({
      ...DETAILS,
      accountHolderName: `  ${DETAILS.accountHolderName}  `,
      accountNumber: ` ${DETAILS.accountNumber} `,
      ownershipReview: { status: "manually_reviewed" },
      id: "attacker-chosen-id",
      userId: "other-user",
      transactionPurpose: "untrusted-extra-field",
    });
    expect(parsed).toEqual({ success: true, data: DETAILS });
    expect(normalizeWiseUsdAccountInput({ routingNumber: "01 9999995" }).routingNumber).toBe("01 9999995");
  });

  it.each([null, undefined, [], 42, "details"])("fails closed on non-object input %j", (input) => {
    expect(parseWiseUsdAccountDetails(input).success).toBe(false);
  });

  it.each([
    ["currency", "EUR"], ["currency", "ILS"], ["currency", undefined],
    ["provider", "bank"], ["provider", undefined],
    ["countryCode", "GB"], ["accountHolderType", "business"],
    ["accountHolderType", undefined], ["accountType", "current"],
    ["accountType", undefined], ["accountNumber", 123456789],
    ["routingNumber", 19999995], ["routingNumber", "019-999995"],
    ["routingNumber", "01 9999995"], ["accountNumber", "0001-23456789"],
    ["accountNumber", "0001 23456789"], ["bankName", ""],
    ["accountHolderName", "1234"], ["accountHolderName", "<script>Example</script>"],
    ["accountHolderName", "Example\u202ePerson"], ["bankAddress", { line: "Test" }],
  ])("rejects invalid %s rather than repairing it", (key, value) => {
    const result = parseWiseUsdAccountDetails({ ...DETAILS, [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[key]).toBeTruthy();
  });

  it.each(["ليلى حسن", "דנה כהן", "李小明", "Zoë O’Connor", "José García"])(
    "allows an international personal name: %s", (accountHolderName) => {
      expect(parseWiseUsdAccountDetails({ ...DETAILS, accountHolderName }).success).toBe(true);
    },
  );

  it("preserves optional bank address and does not invent an empty one", () => {
    const address = "100 Synthetic Avenue, Test City";
    expect(parseWiseUsdAccountDetails({ ...DETAILS, bankAddress: address })).toEqual({
      success: true, data: { ...DETAILS, bankAddress: address },
    });
    expect(parseWiseUsdAccountDetails({ ...DETAILS, bankAddress: "  " })).toEqual({ success: true, data: DETAILS });
  });
});

describe("USD ACH format checks", () => {
  it.each(["01", "12", "21", "32", "61", "72"])("accepts electronic-payment routing prefix %s", (prefix) => {
    expect(isValidAchRoutingNumber(routingWithPrefix(prefix))).toBe(true);
  });

  it.each(["00", "13", "20", "33", "50", "60", "73", "80", "99"])(
    "rejects unsupported routing prefix %s even with a valid checksum", (prefix) => {
      expect(isValidAchRoutingNumber(routingWithPrefix(prefix))).toBe(false);
    },
  );

  it.each(["019999994", "000000000", "01999999", "0199999950", "01999999x", "０１９９９９９９５"])(
    "rejects invalid routing number %s", (value) => expect(isValidAchRoutingNumber(value)).toBe(false),
  );

  it.each(["0001", "12345678901234567"])("preserves valid account-number boundary %s", (value) => {
    expect(isValidWiseUsdAccountNumber(value)).toBe(true);
  });

  it.each(["123", "123456789012345678", "0000", "00000000000000000", "12e4", "-1234", "１２３４"])(
    "rejects invalid account number %s", (value) => expect(isValidWiseUsdAccountNumber(value)).toBe(false),
  );
});

describe("manual ownership review", () => {
  it("recognizes only a current reviewed identity and account-detail combination", () => {
    expect(isWiseOwnershipReviewed(account())).toBe(true);
  });

  it.each([
    { status: "pending_review" },
    { status: "rejected", reviewedAt: "2026-10-25T12:01:00.000Z", reviewedBy: "test-reviewer", evidenceReference: "test-doc" },
    { status: "verified" },
    undefined,
  ])("does not accept a status as proof of review: %j", (ownershipReview) => {
    expect(isWiseOwnershipReviewed({ ...account(), ownershipReview } as WiseUsdAccount)).toBe(false);
  });

  it.each([
    ["reviewedBy", "test-owner"], ["reviewedBy", " test-owner "], ["reviewedBy", ""],
    ["evidenceReference", ""], ["reviewedAt", "not-a-date"],
    ["reviewedAt", "2026-02-31T12:01:00.000Z"],
    ["verifiedAccountHolderName", "Someone Else"], ["method", "self_declared"],
    ["accountFingerprint", ""],
  ])("rejects incomplete or self-issued review: %s", (key, value) => {
    const original = account();
    const updated = { ...original, ownershipReview: { ...original.ownershipReview, [key]: value } } as WiseUsdAccount;
    expect(isWiseOwnershipReviewed(updated)).toBe(false);
  });

  it.each([
    ["routingNumber", routingWithPrefix("02")], ["accountNumber", "000123456780"],
    ["accountHolderName", "Different Test Person"], ["accountType", "savings"],
    ["bankName", "Different Synthetic Bank"], ["bankAddress", "Changed Address"],
  ])("invalidates the old review when %s changes", (key, value) => {
    expect(isWiseOwnershipReviewed({ ...account(), [key]: value })).toBe(false);
  });

  it("creates an immutable private snapshot without review evidence or identifiers", () => {
    const original = account();
    const snapshot = createWiseUsdAccountSnapshot(original);
    expect(snapshot).toEqual({
      ...DETAILS,
      accountId: original.id,
      userId: original.userId,
      ownershipReviewedAt: "2026-10-25T12:01:00.000Z",
      ownershipReviewMethod: "document_review",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    original.accountNumber = "000987654321";
    expect(snapshot.accountNumber).toBe(DETAILS.accountNumber);
    expect(snapshot).not.toHaveProperty("ownershipReview");
    expect(snapshot).not.toHaveProperty("evidenceReference");
    expect(snapshot).not.toHaveProperty("reviewedBy");
  });

  it("refuses to snapshot an unreviewed or changed account", () => {
    expect(() => createWiseUsdAccountSnapshot({ ...account(), ownershipReview: { status: "pending_review" } })).toThrow();
    expect(() => createWiseUsdAccountSnapshot({ ...account(), accountNumber: "000123456780" })).toThrow();
  });

  it("uses an allowlist for masked details and downgrades stale review status", () => {
    const summary = maskWiseUsdAccount(account());
    expect(summary).toEqual({
      id: "wise-test-account", provider: "wise", currency: "USD",
      accountHolderName: DETAILS.accountHolderName, bankName: DETAILS.bankName,
      accountLast4: "6789", routingLast4: "9995", accountType: "checking",
      ownershipReviewStatus: "manually_reviewed",
    });
    for (const key of ["accountNumber", "routingNumber", "ownershipReview", "evidenceReference", "accountFingerprint", "userId"]) {
      expect(summary).not.toHaveProperty(key);
    }
    expect(maskWiseUsdAccount({ ...account(), accountNumber: "000123456780" }).ownershipReviewStatus).toBe("pending_review");
  });
});

describe("Wise matching and draft capability", () => {
  const enabled = {
    ALPHA_WISE_DRAFT_ENABLED: "1", ALPHA_EXCHANGE_DATA_BACKEND: "json",
    ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1",
  };

  it("matches only the explicit Bank Transfer + Wise + USD combination", () => {
    expect(isWiseBankTransfer({ paymentMethod: "Bank Transfer", bankTransferProvider: "wise", currency: "USD" })).toBe(true);
    for (const value of [
      { paymentMethod: "Bank Transfer", currency: "USD" },
      { paymentMethod: "Bank Transfer", bankTransferProvider: "israeli_bank", currency: "USD" },
      { paymentMethod: "Bank Transfer", bankTransferProvider: "wise", currency: "EUR" },
      { paymentMethod: "Bank Transfer", bankTransferProvider: "wise", currency: "ILS" },
      { paymentMethod: "Cardless ATM Withdrawal", bankTransferProvider: "wise", currency: "USD" },
      { paymentMethod: "wise", bankTransferProvider: "wise", currency: "USD" },
      {},
    ]) expect(isWiseBankTransfer(value)).toBe(false);
  });

  it("requires the actual in-memory repository and refuses database or hosted configuration", () => {
    expect(isWiseDraftEnabled(enabled)).toBe(true);
    expect(isWiseDraftEnabled({ ...enabled, NODE_ENV: "production" })).toBe(true);
    for (const env of [
      {}, { ALPHA_WISE_DRAFT_ENABLED: "1" }, { ALPHA_EXCHANGE_DATA_BACKEND: "json" },
      { ...enabled, ALPHA_WISE_DRAFT_ENABLED: "true" },
      { ...enabled, ALPHA_EXCHANGE_DATA_BACKEND: "postgres" },
      { ...enabled, ALPHA_EXCHANGE_DATA_BACKEND: "supabase" },
      { ...enabled, ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: undefined },
      { ...enabled, ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "0" },
      { ...enabled, ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "true" },
      { ...enabled, DATABASE_URL: "synthetic-test-database-setting" },
      { ...enabled, SUPABASE_DB_URL: "synthetic-test-database-setting" },
      { ...enabled, VERCEL_ENV: "production" },
      { ...enabled, VERCEL_ENV: "preview" },
      { ...enabled, VERCEL_ENV: "development" },
      { ...enabled, VERCEL: "1" },
      { ...enabled, RAILWAY_ENVIRONMENT_ID: "test-environment" },
      { ...enabled, RAILWAY_PROJECT_ID: "test-project" },
      { NEXT_PUBLIC_ALPHA_WISE_DRAFT_ENABLED: "1", ALPHA_EXCHANGE_DATA_BACKEND: "json" },
    ]) expect(isWiseDraftEnabled(env)).toBe(false);
  });

  it("refuses an already initialized database pool even when environment settings look local", () => {
    vi.stubGlobal("__alphaTradersRuntimeDbPool", { syntheticPool: true });
    expect(isWiseDraftEnabled(enabled)).toBe(false);
  });

  it("does not allow a browser caller to grant itself the server capability", () => {
    vi.stubGlobal("window", {});
    expect(isWiseDraftEnabled(enabled)).toBe(false);
  });
});
