import type { AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import type { WalletSql } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { simulatedDestination } from "./sandbox";

/** Disposable canonical rows only; never a migration, account signup or trade authority. */
export async function createInitialAcceptanceFixture(options: {
  mode: "simulation-only"; tx: WalletSql; paymentMethod?: "Bank Transfer" | "Face-to-Face"; tradeProjection?: "absent" | "pending";
}) {
  const { mode, tx } = options;
  assertSimulationRuntime(mode);
  const paymentMethod = options.paymentMethod ?? "Bank Transfer";
  if (!["Bank Transfer", "Face-to-Face"].includes(paymentMethod)) throw new Error("Unsupported initial acceptance fixture payment method");
  const tradeProjection = options.tradeProjection ?? "absent";
  if (!["absent", "pending"].includes(tradeProjection)) throw new Error("Unsupported initial acceptance fixture trade projection");
  const context = async () => {
    assertSimulationRuntime(mode);
    const row = (await tx.query<{ isolation: string; read_only: string; development_mode: string; transaction_id: string }>(`
      SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
        current_setting('alpha_wallet.development_schema', true) AS development_mode, txid_current()::text AS transaction_id`)).rows[0];
    if (!row || row.isolation !== "serializable" || row.read_only !== "off" || row.development_mode !== mode
      || !/^[1-9][0-9]*$/.test(row.transaction_id)) throw new Error("Initial acceptance fixture requires an owned writable SERIALIZABLE simulation transaction");
    return row.transaction_id;
  };
  const transactionId = await context();
  if (await context() !== transactionId) throw new Error("Initial acceptance fixture transaction identity changed");
  const present = (await tx.query<{ present: boolean }>("SELECT to_regnamespace('alpha_exchange') IS NOT NULL AS present")).rows[0]?.present;
  if (present) throw new Error("Initial acceptance fixture refuses an existing canonical schema");
  // These are the retained production repository column definitions, limited to
  // the tables this participant reads/writes. Old focused/cohort fixtures stay frozen.
  await tx.exec(`
    CREATE SCHEMA alpha_exchange;
    CREATE TABLE alpha_exchange.runtime_meta (
      singleton boolean PRIMARY KEY DEFAULT true, version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE alpha_exchange.users (
      id text PRIMARY KEY, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL,
      availability_status text NOT NULL, online_status text NOT NULL, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.listings (
      id text PRIMARY KEY, seller_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
      status text NOT NULL, active_trade_request_id text, expires_at timestamptz, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.trades (
      id text PRIMARY KEY, purchase_request_id text NOT NULL UNIQUE, listing_id text NOT NULL, seller_id text NOT NULL,
      buyer_id text NOT NULL, status text NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.purchase_requests (
      id text PRIMARY KEY, trade_id text, listing_id text NOT NULL, seller_id text NOT NULL, buyer_id text NOT NULL,
      status text NOT NULL, timed_out_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.commissions (
      id text PRIMARY KEY, purchase_request_id text, listing_id text, seller_id text NOT NULL, buyer_id text,
      payment_status text NOT NULL, due_at timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.marketplace_enforcement_records (
      id text PRIMARY KEY, seller_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
      status text NOT NULL, violation_number integer NOT NULL, issued_at timestamptz NOT NULL, due_at timestamptz,
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.evidence (
      id text PRIMARY KEY, purchase_request_id text NOT NULL, side text NOT NULL, uploaded_by_user_id text NOT NULL,
      mime_type text NOT NULL, file_name text NOT NULL, size_bytes integer NOT NULL, uploaded_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL, content bytea
    );
    CREATE TABLE alpha_exchange.disputes (
      id text PRIMARY KEY, trade_id text NOT NULL, purchase_request_id text NOT NULL, seller_id text NOT NULL,
      buyer_id text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.notifications (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
      category text NOT NULL, is_read boolean NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.audit_logs (
      id text PRIMARY KEY, action text NOT NULL, actor_user_id text NOT NULL, target_user_id text, listing_id text,
      purchase_request_id text, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
  `);
  const atMs = 1_800_000_000_000, acceptedAtMs = atMs + 1000, at = new Date(atMs).toISOString();
  const requestId = "initial-fixture-request", tradeId = "initial-fixture-trade", listingId = "initial-fixture-listing";
  const sellerId = "fixture-seller", buyerId = "fixture-buyer", otherSellerId = "initial-other-seller", otherBuyerId = "initial-other-buyer";
  const otherRequestId = "initial-seller-sibling", buyerHistoryRequestId = "initial-buyer-other-seller-history", otherListingId = "initial-other-listing";
  const initialRuntimeVersion = "7", bankAccountId = "initial-fixture-bank";
  const users: AlphaExchangeUser[] = [sellerId, buyerId, otherSellerId, otherBuyerId].map((id, index) => {
    const seller = id === sellerId || id === otherSellerId;
    return { id, fullName: `Synthetic ${id}`, email: `${id}@example.invalid`, passwordHash: "synthetic-fixture-not-a-login",
      whatsappNumber: "", preferredNetworks: ["TRC20"], profilePhotoUrl: "", languages: ["en"], bio: "Isolated initial acceptance fixture",
      onlineStatus: "offline", availabilityStatus: "available", role: seller ? "approved_seller" : "buyer",
      sellerStatus: seller ? "approved_seller" : "buyer", emailVerified: true, emailVerifiedAt: at,
      verifiedPhone: `+1202555010${index + 1}`, phoneVerifiedAt: at, ageEligibility: { method: "self_attestation_v1", confirmedAt: at },
      disabled: false, createdAt: at, updatedAt: at,
      ...(seller ? { sellerBankAccounts: [{ id: bankAccountId, sellerId: id, accountHolderName: `Synthetic ${id}`,
        bankName: "Synthetic fixture bank", branchNumber: "000", accountNumber: "0000000000", accountLast4: "0000",
        isDefault: true, createdAt: at, updatedAt: at }] } : {}),
    };
  });
  const initialListing: MarketplaceListing = {
    id: listingId, sellerId, sellerDisplayName: "Synthetic seller", photos: [], originalAmount: "500", availableAmount: "500",
    price: "3.20", currency: "ILS", network: "TRC20", paymentMethod, paymentMethods: [paymentMethod],
    minimumTrade: "1", maximumTrade: "500", sellerDescription: "Isolated initial acceptance fixture", responseTime: "fixture",
    status: "active", approvalStatus: "approved", createdAt: at, updatedAt: at,
    ...(paymentMethod === "Bank Transfer" ? { bankTransferProvider: "israeli_bank" as const, bankAccountId } : {}),
  };
  const initialRequest: PurchaseRequest = {
    id: requestId, tradeId, listingId, sellerId, buyerId, buyerName: "Synthetic buyer", buyerNotes: "Retained buyer request",
    usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20", listingPriceAtRequest: "3.20", priceMode: "listing_price",
    currency: "ILS", network: "TRC20", buyerReceivingWalletAddress: simulatedDestination("tron-sim-usdt", buyerId), paymentMethod,
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2", amountAdjustmentCount: 0,
    buyerSafetyAcknowledged: true, timeline: [{ id: "initial-submission-event", type: "request_submitted", actorUserId: buyerId,
      actorRole: "buyer", message: "Buyer submitted the trade request", createdAt: at }], messages: [],
    status: "pending", createdAt: at, updatedAt: at,
    ...(paymentMethod === "Bank Transfer" ? { bankTransferProvider: "israeli_bank" as const, sellerBankAccountId: bankAccountId,
      sellerBankAccountSnapshot: { accountHolderName: `Synthetic ${sellerId}`, bankName: "Synthetic fixture bank", branchNumber: "000",
        accountNumber: "0000000000", accountLast4: "0000" } } : {}),
  };
  const sibling: PurchaseRequest = { ...structuredClone(initialRequest), id: otherRequestId, tradeId: "initial-sibling-trade", buyerId: otherBuyerId,
    timeline: [{ ...initialRequest.timeline[0], id: "initial-sibling-submission", actorUserId: otherBuyerId }],
    buyerReceivingWalletAddress: simulatedDestination("tron-sim-usdt", otherBuyerId) };
  const history: PurchaseRequest = { ...structuredClone(initialRequest), id: buyerHistoryRequestId, tradeId: "initial-history-trade",
    listingId: otherListingId, sellerId: otherSellerId, status: "cancelled", timeline: [{ ...initialRequest.timeline[0], id: "initial-history-submission" }] };
  const marketplaceListings = [initialListing, { ...structuredClone(initialListing), id: otherListingId, sellerId: otherSellerId }];
  const purchaseRequests = [initialRequest, sibling, history];
  await tx.query("INSERT INTO alpha_exchange.runtime_meta VALUES (true,$1::bigint,$2::timestamptz)", [initialRuntimeVersion, at]);
  for (const [index, user] of users.entries()) {
    await tx.query(`INSERT INTO alpha_exchange.users VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)`,
    [user.id, user.email, user.role, user.sellerStatus, user.availabilityStatus, user.onlineStatus, user.createdAt, user.updatedAt, index, JSON.stringify(user)]);
  }
  for (const [index, listing] of marketplaceListings.entries()) {
    await tx.query(`INSERT INTO alpha_exchange.listings VALUES ($1,$2,$3,NULL,NULL,$4::timestamptz,$5::timestamptz,$6,$7::jsonb)`,
    [listing.id, listing.sellerId, listing.status, listing.createdAt, listing.updatedAt, index + 11, JSON.stringify(listing)]);
  }
  for (const [index, request] of purchaseRequests.entries()) {
    await tx.query(`INSERT INTO alpha_exchange.purchase_requests VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7::timestamptz,$8::timestamptz,$9,$10::jsonb)`,
    [request.id, request.tradeId, request.listingId, request.sellerId, request.buyerId, request.status, request.createdAt, request.updatedAt, index + 21, JSON.stringify(request)]);
  }
  if (tradeProjection === "pending") {
    const projection = { id: tradeId, purchaseRequestId: requestId, listingId, sellerId, buyerId, status: "pending",
      createdAt: at, updatedAt: at, timeline: initialRequest.timeline };
    await tx.query(`INSERT INTO alpha_exchange.trades VALUES ($1,$2,$3,$4,$5,'pending',NULL,$6::timestamptz,$6::timestamptz,31,$7::jsonb)`,
    [tradeId, requestId, listingId, sellerId, buyerId, at, JSON.stringify(projection)]);
  }
  if (await context() !== transactionId) throw new Error("Initial acceptance fixture transaction identity changed");
  return { requestId, tradeId, listingId, sellerId, buyerId, otherSellerId, otherBuyerId, otherRequestId, buyerHistoryRequestId, otherListingId,
    at, atMs, acceptedAtMs, tradeProjection, initialRuntimeVersion, initialRequest, initialListing, users,
    marketplace: { users, marketplaceListings, purchaseRequests, commissionRecords: [], sellerReviews: [],
      marketplaceEnforcementRecords: [], tradeEvidenceFiles: [], disputes: [] } };
}
