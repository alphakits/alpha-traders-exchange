import type { AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import type { WalletSql } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { simulatedDestination } from "./sandbox";

/**
 * Explicit synthetic rows for the focused repository SQL, not a marketplace
 * bootstrap or a migration. Only an already owned, isolated simulation
 * transaction may create them. Existing alpha_exchange schemas are refused.
 */
export async function createMarketplaceTransactionFixture(options: { mode: "simulation-only"; tx: WalletSql }) {
  const { mode, tx } = options;
  assertSimulationRuntime(mode);
  const context = async () => {
    assertSimulationRuntime(mode);
    const result = await tx.query<{ isolation: string; read_only: string; development_mode: string | null; transaction_id: string }>(`
      SELECT current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only,
        current_setting('alpha_wallet.development_schema', true) AS development_mode,
        txid_current()::text AS transaction_id`);
    assertSimulationRuntime(mode);
    const row = result.rows[0];
    if (row?.isolation !== "serializable" || row.read_only !== "off" || row.development_mode !== "simulation-only"
      || typeof row.transaction_id !== "string" || !/^[1-9][0-9]*$/.test(row.transaction_id)) {
      throw new Error("Marketplace fixture requires an explicit writable SERIALIZABLE simulation transaction");
    }
    return row.transaction_id;
  };
  const transactionId = await context();
  const existing = await tx.query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'alpha_exchange') AS present");
  if (existing.rows.length !== 1 || existing.rows[0].present !== false) {
    throw new Error("Marketplace fixture refuses an existing alpha_exchange schema");
  }
  if (await context() !== transactionId) throw new Error("Marketplace fixture requires one explicit transaction owner");

  // Only columns used by the actual focused read and its existing encoders.
  // Each fixture database is disposable; this deliberately has no IF NOT EXISTS.
  await tx.exec(`
    CREATE SCHEMA alpha_exchange;
    CREATE TABLE alpha_exchange.runtime_meta (
      singleton boolean PRIMARY KEY CHECK (singleton), version bigint NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE alpha_exchange.purchase_requests (
      id text PRIMARY KEY, trade_id text UNIQUE, listing_id text NOT NULL, buyer_id text NOT NULL,
      seller_id text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.users (id text PRIMARY KEY, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.listings (id text PRIMARY KEY, seller_id text NOT NULL, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.commissions (id text PRIMARY KEY, seller_id text NOT NULL, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.trust_snapshots (seller_id text PRIMARY KEY, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.evidence (id text PRIMARY KEY, purchase_request_id text NOT NULL, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.disputes (id text PRIMARY KEY, purchase_request_id text NOT NULL, payload jsonb NOT NULL);
    CREATE TABLE alpha_exchange.notifications (
      id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL, is_read boolean NOT NULL,
      created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.audit_logs (
      id text PRIMARY KEY, action text NOT NULL, actor_user_id text NOT NULL, target_user_id text,
      listing_id text, purchase_request_id text, created_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL
    );
    CREATE TABLE alpha_exchange.activity_logs (
      id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL, created_at timestamptz NOT NULL,
      sort_index integer NOT NULL, payload jsonb NOT NULL
    );
  `);
  const at = new Date(1_800_000_000_000).toISOString();
  const requestId = "marketplace-fixture-request";
  const tradeId = "marketplace-fixture-trade";
  const listingId = "marketplace-fixture-listing";
  const sellerId = "fixture-seller";
  const buyerId = "fixture-buyer";
  const otherRequestId = "marketplace-fixture-other-request";
  const initialRuntimeVersion = "7";
  const user = (id: string, seller: boolean): AlphaExchangeUser => ({
    id, fullName: seller ? "Synthetic seller" : "Synthetic buyer", email: `${id}@example.invalid`,
    passwordHash: "synthetic-fixture-not-a-login", whatsappNumber: "", preferredNetworks: ["TRC20"],
    profilePhotoUrl: "", languages: ["en"], bio: "Isolated transaction fixture",
    onlineStatus: "offline", availabilityStatus: "available", role: seller ? "approved_seller" : "buyer",
    sellerStatus: seller ? "approved_seller" : "buyer", createdAt: at, updatedAt: at,
  });
  const initialListing: MarketplaceListing = {
    id: listingId, sellerId, sellerDisplayName: "Synthetic seller", photos: [], originalAmount: "500", availableAmount: "500",
    price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"],
    bankTransferProvider: "israeli_bank", bankAccountId: "marketplace-fixture-bank",
    minimumTrade: "1", maximumTrade: "500", sellerDescription: "Isolated transaction fixture", responseTime: "fixture",
    status: "active", createdAt: at, updatedAt: at,
  };
  const initialRequest: PurchaseRequest = {
    id: requestId, tradeId, listingId, sellerId, buyerId, buyerName: "Synthetic buyer", buyerNotes: "original fixture note",
    usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20", listingPriceAtRequest: "3.20", priceMode: "listing_price",
    currency: "ILS", network: "TRC20", buyerReceivingWalletAddress: simulatedDestination("tron-sim-usdt", buyerId),
    paymentMethod: "Bank Transfer", bankTransferProvider: "israeli_bank", sellerBankAccountId: "marketplace-fixture-bank",
    sellerBankAccountSnapshot: { accountHolderName: "Synthetic seller", bankName: "Synthetic fixture bank", branchNumber: "000", accountNumber: "0000000000", accountLast4: "0000" },
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
    amountAdjustmentCount: 0, timeline: [], status: "pending", createdAt: at, updatedAt: at,
  };
  await tx.query("INSERT INTO alpha_exchange.runtime_meta VALUES (true, $1::bigint, $2::timestamptz)", [initialRuntimeVersion, at]);
  for (const record of [user(sellerId, true), user(buyerId, false)]) {
    await tx.query("INSERT INTO alpha_exchange.users VALUES ($1, $2::jsonb)", [record.id, JSON.stringify(record)]);
  }
  await tx.query("INSERT INTO alpha_exchange.listings VALUES ($1, $2, $3::jsonb)", [listingId, sellerId, JSON.stringify(initialListing)]);
  for (const record of [initialRequest, { ...initialRequest, id: otherRequestId, tradeId: "marketplace-fixture-other-trade" }]) {
    await tx.query(`INSERT INTO alpha_exchange.purchase_requests
      (id, trade_id, listing_id, buyer_id, seller_id, status, updated_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
    [record.id, record.tradeId, record.listingId, record.buyerId, record.sellerId, record.status, record.updatedAt, JSON.stringify(record)]);
  }
  if (await context() !== transactionId) throw new Error("Marketplace fixture transaction identity changed");
  return { requestId, tradeId, listingId, sellerId, buyerId, otherRequestId, at, initialRuntimeVersion, initialRequest, initialListing };
}
