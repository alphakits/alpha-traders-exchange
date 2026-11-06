// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES, PaymentMarketplacePlanningError, assertDevelopmentPaymentEvidence, normalizeDevelopmentPaymentDisputeReason,
  normalizeDevelopmentPaymentEvidenceInput, paymentCanonicalCommitment, planDevelopmentPaymentClaim, planDevelopmentPaymentDispute,
  type DevelopmentPaymentClaimDecision, type DevelopmentPaymentDisputeDecision, type DevelopmentPaymentEvidence,
  type DevelopmentPaymentMarketplace } from "./payment-marketplace-canonical";
import { simulatedDestination } from "./sandbox";

const AT = 1_800_000_000_000, ACCEPTED = AT + 1000, CLAIMED = AT + 2000, DISPUTED = AT + 3000;
const createdAt = new Date(AT).toISOString(), acceptedAt = new Date(ACCEPTED).toISOString();
const proof = { mimeType: "application/pdf" as const, contentBase64: Buffer.from("%PDF-1.7\nSynthetic development receipt\n%%EOF").toString("base64") };
type MutableMarketplace = { [K in keyof DevelopmentPaymentMarketplace]: Array<DevelopmentPaymentMarketplace[K][number]> };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function fixture(method: "Bank Transfer" | "Face-to-Face" | "Face-to-Face (Meet in Person)" = "Bank Transfer", network: "TRC20" | "BEP20" = "TRC20") {
  const users: AlphaExchangeUser[] = ["payment-seller", "payment-buyer", "payment-owner"].map((id, index) => ({
    id, fullName: `Synthetic ${id}`, email: `${id}@example.invalid`, passwordHash: "synthetic-not-a-login", whatsappNumber: "",
    preferredNetworks: [network], profilePhotoUrl: "", languages: ["en"], bio: "Fixture", onlineStatus: "offline", availabilityStatus: "available",
    role: index === 0 ? "approved_seller" : index === 1 ? "buyer" : "owner", sellerStatus: index === 0 ? "approved_seller" : "buyer",
    disabled: false, createdAt, updatedAt: createdAt,
  }));
  const [seller, buyer, owner] = users;
  const request: PurchaseRequest = { id: "payment-request", tradeId: "payment-trade", listingId: "payment-listing",
    sellerId: seller.id, buyerId: buyer.id, buyerName: "Synthetic buyer", usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20",
    listingPriceAtRequest: "3.20", priceMode: "listing_price", currency: "ILS", network, paymentMethod: method,
    buyerReceivingWalletAddress: simulatedDestination(network === "TRC20" ? "tron-sim-usdt" : "bsc-sim-binance-peg-usdt", buyer.id),
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2", amountAdjustmentCount: 0,
    status: "accepted", createdAt, updatedAt: acceptedAt, tradeCreatedAt: acceptedAt, messages: [],
    timeline: [{ id: "payment-submission", type: "request_submitted", actorUserId: buyer.id, actorRole: buyer.role, message: "Buyer submitted request", createdAt },
      { id: "payment-acceptance", type: "request_accepted", actorUserId: seller.id, actorRole: seller.role, message: "Seller accepted request", createdAt: acceptedAt }],
    ...(method === "Bank Transfer" ? { bankTransferProvider: "israeli_bank" as const, sellerBankAccountId: "payment-bank",
      sellerBankAccountSnapshot: { accountHolderName: "Synthetic seller", bankName: "Synthetic bank", branchNumber: "000", accountNumber: "00000000", accountLast4: "0000" } } : {}),
  };
  const listing: MarketplaceListing = { id: request.listingId, sellerId: seller.id, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: "500", availableAmount: "500", price: "3.40", currency: "ILS", network, paymentMethod: method, paymentMethods: [method],
    minimumTrade: "1", maximumTrade: "500", sellerDescription: "Fixture", responseTime: "Fixture", status: "matched", approvalStatus: "approved",
    activeTradeRequestId: request.id, lockedAt: acceptedAt, createdAt, updatedAt: acceptedAt };
  const marketplace: MutableMarketplace = { users, marketplaceListings: [listing], purchaseRequests: [request], commissionRecords: [],
    sellerReviews: [], marketplaceEnforcementRecords: [], tradeEvidenceFiles: [], disputes: [], notifications: [] };
  const decision: DevelopmentPaymentClaimDecision = { requestId: request.id, tradeId: request.tradeId!, actorUserId: buyer.id, claimedAtMs: CLAIMED,
    ...(method === "Bank Transfer" ? { evidence: { ...proof } } : {}) };
  return { marketplace, decision, request, listing, seller, buyer, owner };
}
type Fixture = ReturnType<typeof fixture>;
function claim(f: Fixture, extra: Partial<DevelopmentPaymentClaimDecision> = {}) {
  return planDevelopmentPaymentClaim(f.marketplace, { ...f.decision, ...extra });
}
function paid(f: Fixture, result = claim(f)) {
  f.marketplace.purchaseRequests = [structuredClone(result.request)]; f.request = f.marketplace.purchaseRequests[0];
  f.marketplace.marketplaceListings = [structuredClone(result.listing)]; f.listing = f.marketplace.marketplaceListings[0];
  f.marketplace.tradeEvidenceFiles = result.evidence.map(item => structuredClone(item.metadata));
  f.marketplace.notifications.push(...structuredClone(result.notifications));
  return result;
}
function dispute(f: Fixture, evidence: readonly DevelopmentPaymentEvidence[], extra: Partial<DevelopmentPaymentDisputeDecision> = {}) {
  return planDevelopmentPaymentDispute(f.marketplace, { requestId: f.request.id, tradeId: f.request.tradeId!,
    actorUserId: f.buyer.id, openedAtMs: DISPUTED, reason: "The seller has not confirmed my payment.", ...extra }, evidence);
}
function reminder(f: Fixture, id: string, patch: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return { id, userId: f.buyer.id, category: "trade", title: "Action required", message: "Synthetic reminder", isRead: false,
    state: "unread", relatedRequestId: f.request.id, relatedTradeId: f.request.tradeId, relatedListingId: f.listing.id,
    reason: "automatic_trade_action_reminder", createdAt: acceptedAt, ...patch };
}
function expectInvalidEvidence(input: unknown, reason: string) {
  let caught: unknown;
  try { normalizeDevelopmentPaymentEvidenceInput(input); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(PaymentMarketplacePlanningError);
  expect(caught).toMatchObject({ code: "INVALID", message: `Payment marketplace ${reason}.` });
}

describe("exact canonical buyer payment claim", () => {
  it.each([
    ["Bank Transfer", "TRC20"], ["Bank Transfer", "BEP20"], ["Face-to-Face", "TRC20"], ["Face-to-Face (Meet in Person)", "BEP20"],
  ] as const)("records %s on %s with unchanged principal, terms, lock and private data", (method, network) => {
    const f = fixture(method, network), before = structuredClone(f.marketplace);
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Ambient clock is forbidden"); });
    const result = claim(f); expect(result).toEqual(claim(f)); expect(f.marketplace).toEqual(before);
    expect(result.request.status).toBe("payment_sent"); expect(result.request.paymentSentAt).toBe(new Date(CLAIMED).toISOString());
    expect(result.request.trustReconciliation).toBeUndefined(); expect(result.request.fundsReceivedAt).toBeUndefined();
    for (const key of ["usdtAmount", "fiatAmount", "pricePerUsdt", "feePolicyVersion", "buyerReceivingWalletAddress", "sellerBankAccountSnapshot"] as const) {
      expect(result.request[key]).toEqual(f.request[key]);
    }
    expect(result.listing).toEqual({ ...f.listing, status: "in_trade", updatedAt: new Date(CLAIMED).toISOString() });
    expect(result.trade).toMatchObject({ id: f.request.tradeId, purchaseRequestId: f.request.id, status: "payment_sent", createdAt: acceptedAt, timeline: result.request.timeline });
    expect(result.notifications.map(item => item.userId)).toEqual([f.seller.id]); expect(result.disputes).toEqual([]);
    expect(result.auditLogs).toHaveLength(1); expect(result.auditLogs[0].action).toBe("trade_payment_claimed");
    expect(Object.isFrozen(result.request.timeline)).toBe(true);
    if (method === "Bank Transfer") {
      expect(result.evidence).toHaveLength(1);
      const evidence = result.evidence[0]; assertDevelopmentPaymentEvidence(evidence, result.request);
      expect(evidence.metadata.sizeBytes).toBe(Buffer.from(proof.contentBase64, "base64").length);
      expect(evidence.contentDigest).toBe(createHash("sha256").update(Buffer.from(proof.contentBase64, "base64")).digest("hex"));
      expect(result.request.buyerEvidence).toEqual(evidence.metadata);
      expect(result.request.timeline.slice(-2).map(item => item.type)).toEqual(["buyer_evidence_uploaded", "payment_sent"]);
      expect(JSON.stringify(paymentCanonicalCommitment(result))).not.toContain("contentBase64");
    } else { expect(result.evidence).toEqual([]); expect(result.request.buyerEvidence).toBeUndefined(); }
  });

  it("preserves bank disclosure and an elapsed expiry without returning inventory", () => {
    const f = fixture(); f.request.sensitivePaymentKind = "bank_details"; f.request.sensitivePaymentSharedAt = acceptedAt;
    f.listing.expiresAt = acceptedAt;
    const result = claim(f);
    expect(result.request.sensitivePaymentSharedAt).toBe(acceptedAt); expect(result.listing.expiresAt).toBe(acceptedAt);
    expect(result.listing.availableAmount).toBe("500"); expect(result.listing.activeTradeRequestId).toBe(f.request.id);
  });
  it("archives only the old accepted-stage buyer reminders", () => {
    const f = fixture(); f.request.actionReminderState = { stage: "accepted", actionStartedAt: acceptedAt };
    f.request.inactivityWarningSentAt = acceptedAt;
    f.marketplace.notifications.push(reminder(f, "buyer"), reminder(f, "seller", { userId: f.seller.id }), reminder(f, "other", { relatedRequestId: "other-request" }));
    const result = claim(f);
    expect(result.notificationUpdates.map(item => item.id)).toEqual(["buyer"]);
    expect(result.notificationUpdates[0]).toMatchObject({ state: "archived", isRead: true });
    expect(result.request.actionReminderState).toBeUndefined(); expect(result.request.inactivityWarningSentAt).toBeUndefined();
  });
  it.each(["seller", "owner"] as const)("refuses %s authority for a buyer claim", side => {
    const f = fixture(); expect(() => claim(f, { actorUserId: f[side].id })).toThrow("retained buyer");
  });
  it("keeps actual buyer identity after role changes, while disabled actors fail", () => {
    const f = fixture(); f.buyer.role = "owner"; expect(claim(f).request.timeline.at(-1)?.actorRole).toBe("owner");
    f.buyer.disabled = true; expect(() => claim(f)).toThrow("retained buyer");
  });
  it.each([0, ACCEPTED, NaN, Infinity, -1])("refuses invalid or stale claim time %s", claimedAtMs => {
    expect(() => claim(fixture(), { claimedAtMs })).toThrow();
  });
  it.each(["fundsReceivedAt", "usdtReleaseStartedAt", "usdtSentAt", "completedAt", "lockedAt", "timedOutAt"] as const)("refuses retained later marker %s", field => {
    const f = fixture(); f.request[field] = acceptedAt; expect(() => claim(f)).toThrow();
  });
  it.each(["payment_sent", "buyer_evidence_uploaded", "seller_confirmed_funds", "dispute_opened", "request_cancelled"] as const)("refuses contradictory retained %s history", type => {
    const f = fixture(); f.request.timeline.push({ id: "contradiction", type, actorUserId: f.buyer.id, actorRole: "buyer", message: "retained", createdAt: acceptedAt });
    expect(() => claim(f)).toThrow();
  });
  it("refuses missing bank evidence and cash proof uploads", () => {
    expect(() => claim(fixture(), { evidence: undefined })).toThrow("requires Bank Transfer");
    expect(() => claim(fixture("Face-to-Face"), { evidence: proof })).toThrow("does not accept photo");
  });
  it("refuses duplicate canonical identities and absent listing lock", () => {
    const f = fixture(); f.marketplace.purchaseRequests.push(structuredClone(f.request)); expect(() => claim(f)).toThrow("duplicate");
    f.marketplace.purchaseRequests.pop(); f.listing.activeTradeRequestId = undefined; expect(() => claim(f)).toThrow("listing lock");
  });
});

describe("bounded exact evidence and reason inputs", () => {
  it.each([
    { ...proof, contentBase64: `${proof.contentBase64}\n` }, { ...proof, contentBase64: "%%%" },
    { ...proof, contentBase64: Buffer.from("plain text").toString("base64") }, { ...proof, mimeType: "image/png" },
    { ...proof, mimeType: "image/webp" }, { ...proof, fileName: "caller-secret.pdf" }, { ...proof, sizeBytes: 1 },
  ])("refuses malformed, mismatched or caller-selected evidence metadata %#", input => {
    expect(() => normalizeDevelopmentPaymentEvidenceInput(input)).toThrow();
  });
  it.each([
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])], ["application/pdf", Buffer.from("%PDF-1.7\n%%EOF")],
  ] as const)("checks the supported %s magic signature", (mimeType, bytes) => {
    expect(normalizeDevelopmentPaymentEvidenceInput({ mimeType, contentBase64: bytes.toString("base64") })).toMatchObject({ mimeType, sizeBytes: bytes.length });
  });
  it("enforces the byte limit independently of caller declarations", () => {
    const bytes = Buffer.alloc(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES + 1); bytes.write("%PDF-1.7");
    expectInvalidEvidence({ mimeType: proof.mimeType, contentBase64: bytes.toString("base64") }, "requires exact bounded evidence bytes");
  });
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ] as const)("accepts the exact eight MiB limit for %s without a regex stack overflow", (mimeType, signature) => {
    // Allocate inside each case, rather than retaining three large buffers in the case table.
    const bytes = Buffer.alloc(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES);
    bytes.set(signature);
    const contentBase64 = bytes.toString("base64");
    const result = normalizeDevelopmentPaymentEvidenceInput({ mimeType, contentBase64 });
    expect(result.sizeBytes).toBe(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES);
    expect(result.mimeType).toBe(mimeType);
    expect(result.contentBase64 === contentBase64).toBe(true);
    expect(result.contentDigest).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it.each(["alphabet", "interior padding", "nonzero pad bits"] as const)("rejects large malformed %s with the typed validation error", kind => {
    const bytes = Buffer.alloc(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES); bytes.write("%PDF-1.7");
    const valid = bytes.toString("base64");
    const contentBase64 = kind === "alphabet" ? `${valid.slice(0, -4)}!AA=`
      : kind === "interior padding" ? `${valid.slice(0, -8)}=AAA${valid.slice(-4)}`
      : `${valid.slice(0, -2)}B=`;
    const message = kind === "nonzero pad bits" ? "requires exact bounded evidence bytes" : "requires strict base64 evidence bytes";
    expectInvalidEvidence({ mimeType: proof.mimeType, contentBase64 }, message);
  });
  it.each(["A===", "====", "AA=A", "AAAA=", "AA-_", "AA\n="])("rejects noncanonical small base64 %j", contentBase64 => {
    expectInvalidEvidence({ mimeType: proof.mimeType, contentBase64 }, "requires strict base64 evidence bytes");
  });
  it.each(["", "   ", "x".repeat(501), "Contact me at test@example.com"]) ("refuses invalid private dispute reason %#", reason => {
    expect(() => normalizeDevelopmentPaymentDisputeReason(reason)).toThrow();
  });
  it("normalizes only surrounding whitespace and supports the exact reason bound", () => {
    expect(normalizeDevelopmentPaymentDisputeReason("  Payment is still unconfirmed.\n")).toBe("Payment is still unconfirmed.");
    expect(normalizeDevelopmentPaymentDisputeReason("x".repeat(500))).toHaveLength(500);
  });
});

describe("canonical dispute freeze after the exact claim", () => {
  it.each(["Bank Transfer", "Face-to-Face"] as const)("opens a buyer %s dispute with exact linkage and unchanged held terms", method => {
    const f = fixture(method), original = paid(f), before = structuredClone(f.marketplace);
    f.marketplace.notifications.push(reminder(f, "buyer-reminder"), reminder(f, "seller-reminder", { userId: f.seller.id }));
    const result = dispute(f, original.evidence, { reason: "  Payment is unconfirmed.  " });
    expect(result.request.status).toBe("payment_sent"); expect(result.request.paymentSentAt).toBe(original.request.paymentSentAt);
    expect(result.listing).toEqual(original.listing); expect(result.request.trustReconciliation).toBeUndefined();
    expect(result.disputes).toEqual([expect.objectContaining({ status: "open", openedByUserId: f.buyer.id,
      reason: "Payment is unconfirmed.", purchaseRequestId: f.request.id, tradeId: f.request.tradeId })]);
    expect(result.disputes[0].buyerEvidenceId).toBe(original.evidence[0]?.metadata.id); expect(result.evidence).toEqual([]);
    expect(result.notificationUpdates.map(item => item.id)).toEqual(["buyer-reminder", "seller-reminder"]);
    expect(result.notifications.map(item => item.userId)).toEqual([f.buyer.id, f.seller.id]);
    expect(result.auditLogs[0].action).toBe("trade_dispute_opened");
    expect(f.marketplace.purchaseRequests).toEqual(before.purchaseRequests); expect(result.request.timeline.at(-1)?.type).toBe("dispute_opened");
  });
  it("refuses an accepted request without its prior exact claim", () => {
    expect(() => dispute(fixture(), [])).toThrow("payment_sent lifecycle");
  });
  it.each(["seller", "owner"] as const)("refuses %s opening the buyer dispute", side => {
    const f = fixture(), original = paid(f); expect(() => dispute(f, original.evidence, { actorUserId: f[side].id })).toThrow("retained buyer");
  });
  it.each(["id", "uploadedByUserId", "storagePath", "sizeBytes"] as const)("refuses forged stored evidence %s", field => {
    const f = fixture(), original = paid(f), evidence = structuredClone(original.evidence);
    Object.assign(evidence[0].metadata, { [field]: field === "sizeBytes" ? 1 : "forged" });
    expect(() => dispute(f, evidence)).toThrow();
  });
  it("refuses changed bytes/digest even when metadata identities match", () => {
    const f = fixture(), original = paid(f), evidence = structuredClone(original.evidence);
    evidence[0] = { ...evidence[0], contentBase64: Buffer.from("%PDF-1.7\nDifferent receipt").toString("base64") };
    expect(() => dispute(f, evidence)).toThrow();
    evidence[0] = { ...original.evidence[0], contentDigest: "0".repeat(64) }; expect(() => dispute(f, evidence)).toThrow();
  });
  it("refuses unbound duplicate, missing or mismatched embedded evidence", () => {
    const f = fixture(), original = paid(f); expect(() => dispute(f, [])).toThrow("one exact");
    f.request.buyerEvidence = { ...f.request.buyerEvidence!, id: "different" }; expect(() => dispute(f, original.evidence)).toThrow("disagree");
  });
  it("refuses a claim reconstructed under an unrelated event identity", () => {
    const f = fixture(), original = paid(f); f.request.timeline.at(-1)!.id = "unrelated-event";
    expect(() => dispute(f, original.evidence)).toThrow("timeline linkage");
  });
  it("refuses a second or resolved prior dispute and stale dispute clocks", () => {
    const f = fixture(), original = paid(f); expect(() => dispute(f, original.evidence, { openedAtMs: CLAIMED })).toThrow("strictly later");
    f.marketplace.disputes.push({ id: "earlier", purchaseRequestId: f.request.id, tradeId: f.request.tradeId!, status: "resolved" } as never);
    expect(() => dispute(f, original.evidence)).toThrow("existing target dispute");
  });
});
