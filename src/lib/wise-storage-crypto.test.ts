// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeWiseStorage, serializeWiseStorageJson } from "@/lib/wise-storage-crypto";

const secret = "synthetic-current-wise-encryption-secret-1";
const previous = "synthetic-previous-wise-encryption-secret-2";
const account = { id: "wise-buyer", userId: "buyer", accountNumber: "00012345678", routingNumber: "021000021",
  accountHolderName: "Synthetic Buyer", bankName: "Synthetic Bank", ownershipReview: { evidenceReference: "private-document-abc", accountFingerprint: "private-account-fingerprint" } };
const user = () => ({ id: "buyer", email: "synthetic@example.test", wiseUsdAccounts: [account] });
const encode = (value: unknown) => JSON.parse(serializeWiseStorageJson(value));
afterEach(() => vi.unstubAllEnvs());

describe("Wise private storage envelope", () => {
  it("uses symmetric scopes for nested audit entity copies and leaves unrelated scalar metadata alone", () => {
    const audit = { id: "audit", oldValue: user(), newValue: { ...user(), wiseUsdAccounts: [] } };
    expect(serializeWiseStorageJson(audit)).not.toContain(account.accountNumber);
    expect(decodeWiseStorage(encode(audit))).toEqual(audit);
    const metadata = { label: "metadata", buyerWiseAccountSnapshot: "ordinary text" };
    expect(serializeWiseStorageJson(metadata)).toBe(JSON.stringify(metadata));
    expect(decodeWiseStorage(metadata)).toBe(metadata);
  });
  it("encrypts every private field, retains surrounding metadata, and roundtrips nested snapshots without mutating input", () => {
    const snapshot = { users: [user()], purchaseRequests: [{ id: "trade", buyerWiseAccountSnapshot: account, sellerWiseAccountSnapshot: { ...account, userId: "seller" } }] };
    const raw = serializeWiseStorageJson(snapshot);
    for (const sensitive of [account.accountNumber, account.routingNumber, account.accountHolderName, "private-document-abc", "private-account-fingerprint"]) expect(raw).not.toContain(sensitive);
    expect(raw).toContain("synthetic@example.test");
    expect(decodeWiseStorage(JSON.parse(raw))).toEqual(snapshot);
    expect(snapshot.users[0].wiseUsdAccounts[0]).toEqual(account);
  });
  it("uses independent nonces for repeated writes", () => expect(serializeWiseStorageJson(user())).not.toEqual(serializeWiseStorageJson(user())));
  it("rejects ciphertext moved between rows or private fields", () => {
    const stored = encode(user());
    expect(() => decodeWiseStorage({ ...stored, id: "outsider" })).toThrow("Private Wise storage is unavailable.");
    expect(() => decodeWiseStorage({ id: "buyer", buyerWiseAccountSnapshot: stored.wiseUsdAccounts })).toThrow("Private Wise storage is unavailable.");
  });
  it.each(["wise-data:v2:unknown", "wise-data:v1:broken", "plaintext-account-details"])("rejects unsupported or malformed envelopes: %s", value => {
    expect(() => decodeWiseStorage({ id: "buyer", wiseUsdAccounts: value })).toThrow("Private Wise storage is unavailable.");
  });
  it("rejects changed authentication tags without exposing details", () => {
    const stored = encode(user());
    const parts = stored.wiseUsdAccounts.split(":");
    parts[3] = Buffer.alloc(16).toString("base64url");
    expect(() => decodeWiseStorage({ ...stored, wiseUsdAccounts: parts.join(":") })).toThrow(/^Private Wise storage is unavailable\.$/);
  });
  it("supports a previous read key while all new writes use the current key", () => {
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", previous);
    const old = encode(user());
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", secret);
    expect(() => decodeWiseStorage(old)).toThrow();
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET", previous);
    expect(decodeWiseStorage(old)).toEqual(user());
    const current = encode(user());
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET", "");
    expect(decodeWiseStorage(current)).toEqual(user());
    expect(() => decodeWiseStorage(old)).toThrow();
  });
  it.each([{ NODE_ENV: "production" }, { VERCEL: "1" }, { RAILWAY_PROJECT_ID: "synthetic-project" }])("fails closed on hosted plaintext and missing dedicated key: %j", env => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", "");
    expect(() => decodeWiseStorage(user())).toThrow();
    expect(() => serializeWiseStorageJson(user())).toThrow();
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", secret);
    expect(decodeWiseStorage(encode(user()))).toEqual(user());
  });
  it("does not need encryption keys for existing non-Wise records or empty account lists", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", "");
    const legacy = { id: "legacy", sellerBankAccounts: [{ accountNumber: "existing-legacy-value" }], wiseUsdAccounts: [] };
    expect(serializeWiseStorageJson(legacy)).toBe(JSON.stringify(legacy));
    expect(decodeWiseStorage(legacy)).toBe(legacy);
  });
  it("rejects malformed keys and oversized payloads", () => {
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", "too-short");
    expect(() => serializeWiseStorageJson(user())).toThrow();
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", secret);
    expect(() => serializeWiseStorageJson({ ...user(), wiseUsdAccounts: [{ private: "x".repeat(70_000) }] })).toThrow();
  });
});
