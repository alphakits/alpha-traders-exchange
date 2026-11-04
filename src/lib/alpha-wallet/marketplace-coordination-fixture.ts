import { createHash } from "node:crypto";
import { calculateTradeTermsQuote, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { AlphaExchangeUser, AuthSession, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import type { WalletSql } from "./durable-store";
import { createMarketplaceTransactionFixture } from "./marketplace-transaction-fixture";
import { assertSimulationRuntime } from "./runtime";

/**
 * Disposable, synthetic canonical SQL and real-shaped web-session rows for the
 * development coordinator. This is neither an account signup nor a migration.
 * The underlying fixture refuses an existing alpha_exchange schema, and every
 * write uses the caller's already owned SERIALIZABLE simulation transaction.
 */
export async function createMarketplaceCoordinationFixture(options: {
  mode: "simulation-only"; tx: WalletSql; paymentMethod?: "Bank Transfer" | "Face-to-Face";
}) {
  assertSimulationRuntime(options.mode);
  const { tx } = options;
  const base = await createMarketplaceTransactionFixture(options);
  const paymentMethod = options.paymentMethod ?? "Bank Transfer";
  if (paymentMethod !== "Bank Transfer" && paymentMethod !== "Face-to-Face") {
    throw new Error("Synthetic coordination fixture supports only its explicit development payment cohort");
  }
  await tx.exec(`
    ALTER TABLE alpha_exchange.users ADD COLUMN email text;
    ALTER TABLE alpha_exchange.users ADD COLUMN role text;
    ALTER TABLE alpha_exchange.users ADD COLUMN seller_status text;
    ALTER TABLE alpha_exchange.listings ADD COLUMN status text;
    ALTER TABLE alpha_exchange.listings ADD COLUMN active_trade_request_id text;
    ALTER TABLE alpha_exchange.commissions ADD COLUMN purchase_request_id text;
    ALTER TABLE alpha_exchange.commissions ADD COLUMN listing_id text;
    ALTER TABLE alpha_exchange.commissions ADD COLUMN buyer_id text;
    CREATE TABLE alpha_exchange.sessions (
      token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.trades (
      id text PRIMARY KEY, purchase_request_id text UNIQUE NOT NULL, listing_id text NOT NULL,
      seller_id text NOT NULL, buyer_id text NOT NULL, status text NOT NULL, payload jsonb NOT NULL
    );
  `);

  const ownerId = "fixture-owner";
  // Public test credentials only; no real cookie, account, key or destination.
  const ownerSessionToken = "a1".repeat(32);
  const buyerSessionToken = "b2".repeat(32);
  const sellerSessionToken = "c3".repeat(32);
  const sessionsExpireAtMs = Date.parse(base.at) + 60 * 60 * 1000;
  const accounts: AlphaExchangeUser[] = [];
  for (const [id, role, phone] of [
    [base.buyerId, "buyer", "+12025550101"],
    [base.sellerId, "approved_seller", "+12025550102"],
    [ownerId, "owner", "+12025550103"],
  ] as const) {
    const record: AlphaExchangeUser = {
      id, fullName: `Synthetic ${role}`, email: `${id}@example.invalid`,
      passwordHash: "synthetic-fixture-not-a-login", whatsappNumber: "", preferredNetworks: ["TRC20"],
      profilePhotoUrl: "", languages: ["en"], bio: "Isolated development coordination fixture",
      onlineStatus: "offline", availabilityStatus: "available", role,
      sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
      emailVerified: true, emailVerifiedAt: base.at, verifiedPhone: phone, phoneVerifiedAt: base.at,
      ageEligibility: { method: "self_attestation_v1", confirmedAt: base.at }, disabled: false,
      createdAt: base.at, updatedAt: base.at,
    };
    accounts.push(record);
    await tx.query(`INSERT INTO alpha_exchange.users (id, email, role, seller_status, payload)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, role=EXCLUDED.role,
        seller_status=EXCLUDED.seller_status, payload=EXCLUDED.payload`,
    [id, record.email, record.role, record.sellerStatus, JSON.stringify(record)]);
  }
  await tx.exec(`
    ALTER TABLE alpha_exchange.users ALTER COLUMN email SET NOT NULL;
    ALTER TABLE alpha_exchange.users ALTER COLUMN role SET NOT NULL;
    ALTER TABLE alpha_exchange.users ALTER COLUMN seller_status SET NOT NULL;
    ALTER TABLE alpha_exchange.users ADD CONSTRAINT coordination_fixture_users_email UNIQUE (email);
  `);
  for (const [index, [id, token]] of [
    [ownerId, ownerSessionToken], [base.buyerId, buyerSessionToken], [base.sellerId, sellerSessionToken],
  ].entries()) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session: AuthSession = { token: tokenHash, userId: id, createdAt: base.at,
      expiresAt: new Date(sessionsExpireAtMs).toISOString(), deviceLabel: "Synthetic development fixture" };
    await tx.query(`INSERT INTO alpha_exchange.sessions
      (token_hash,user_id,expires_at,created_at,sort_index,payload)
      VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6::jsonb)`,
    [tokenHash, id, session.expiresAt, session.createdAt, index, JSON.stringify(session)]);
  }

  const quote = (amount: string) => {
    const result = calculateTradeTermsQuote({ paymentMethod, currency: "ILS", usdtAmount: amount,
      fiatAmount: "0.00", pricePerUsdt: "3.20", feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", amount);
    if (!result) throw new Error("Synthetic coordination quote must be supported");
    return result;
  };
  const proposalId = "marketplace-fixture-amount-proposal";
  const initialRequest: PurchaseRequest = {
    ...base.initialRequest, ...quote("200"), paymentMethod, status: "accepted", messages: [],
    feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION,
    amountAdjustmentCount: 1,
    termsProposal: { id: proposalId, kind: "amount_correction", status: "pending", createdAt: base.at, ...quote("300") },
  };
  const initialListing: MarketplaceListing = {
    ...base.initialListing, paymentMethod, paymentMethods: [paymentMethod],
    status: "matched", approvalStatus: "approved", activeTradeRequestId: base.requestId, lockedAt: base.at,
  };
  const otherRequest: PurchaseRequest = {
    ...base.initialRequest, paymentMethod, id: base.otherRequestId, tradeId: "marketplace-fixture-other-trade",
  };
  if (paymentMethod === "Face-to-Face") {
    for (const request of [initialRequest, otherRequest]) {
      delete request.bankTransferProvider;
      delete request.sellerBankAccountId;
      delete request.sellerBankAccountSnapshot;
    }
    delete initialListing.bankTransferProvider;
    delete initialListing.bankAccountId;
  }
  for (const request of [initialRequest, otherRequest]) {
    await tx.query("UPDATE alpha_exchange.purchase_requests SET status=$2, payload=$3::jsonb WHERE id=$1",
      [request.id, request.status, JSON.stringify(request)]);
    // Match the platform's derived trade encoder. Amounts remain canonical in
    // purchase_requests; the trade projection carries identities and lifecycle.
    const trade = { id: request.tradeId ?? request.id, purchaseRequestId: request.id, listingId: request.listingId,
      sellerId: request.sellerId, buyerId: request.buyerId, status: request.status,
      createdAt: request.tradeCreatedAt ?? request.createdAt, updatedAt: request.updatedAt, timeline: request.timeline };
    await tx.query(`INSERT INTO alpha_exchange.trades
      (id,purchase_request_id,listing_id,seller_id,buyer_id,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [trade.id, request.id, request.listingId, request.sellerId, request.buyerId, request.status, JSON.stringify(trade)]);
  }
  await tx.query("UPDATE alpha_exchange.listings SET payload=$2::jsonb,status=$3,active_trade_request_id=$4 WHERE id=$1",
    [base.listingId, JSON.stringify(initialListing), initialListing.status, initialListing.activeTradeRequestId]);
  await tx.exec("ALTER TABLE alpha_exchange.listings ALTER COLUMN status SET NOT NULL");
  assertSimulationRuntime(options.mode);
  return { ...base, initialRequest, initialListing, otherRequest, ownerId, proposalId,
    ownerSessionToken, buyerSessionToken, sellerSessionToken, sessionsExpireAtMs, accounts };
}
