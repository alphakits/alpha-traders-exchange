import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import type { WalletSql, WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { State } from "../../src/lib/alpha-wallet/types";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "../../src/lib/alpha-wallet/versioned-durable";
import { initialInputFromPlan, v3Command } from "../../src/lib/alpha-wallet/v3-commands";
import { isV3State } from "../../src/lib/alpha-wallet/v3-engine";
import { createV3InitialAcceptanceFixture } from "../../src/lib/alpha-wallet/v3-fixtures";
import { createV3DurableWallet, upgradeDurableWalletV3 } from "../../src/lib/alpha-wallet/v3-durable";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "./durable-fixtures";

/** Synthetic ledger only: no account creation, canonical database, authentication, or provider. */
export const V3_FIXTURE_LISTING = "v3-fixture-listing";
export const V3_FIXTURE_TRADE = "v3-fixture-trade";
export const V3_FIXTURE_REQUEST = "v3-fixture-request";
export const V3_RESTORE_AT = FIXTURE_TIME + 100_000;

export function v3FixtureCheckpoint(snapshot: { revision: number; eventHash: string; state: State; lastCommandAtMs: number }) {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash,
    stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
}
export async function v3FixtureHistory(tx: WalletSql, maximum = 100_000) {
  return (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands WHERE revision <= $1 ORDER BY revision`, [maximum])).rows;
}

/** A genuine original prefix, explicit two-step upgrade, then a seller-native financial command. */
export async function buildV3AcceptanceFixture(store: WalletStore, options: {
  accept?: boolean; pause?: boolean; unknownWithdrawal?: boolean;
} = {}) {
  await initializeDurableWallet(store);
  let clock = FIXTURE_TIME;
  const v1 = createDurableWallet({ mode: "simulation-only", store, clock: () => ++clock });
  const fixture = durableFixture(v1);
  await fixture.fundedListing("500", V3_FIXTURE_LISTING);
  let historicalDispatch: ReturnType<typeof walletCommand<"beginDispatch">> | undefined;
  if (options.unknownWithdrawal !== false) {
    await fixture.deposit("100");
    await fixture.ready();
    const withdrawal = (await fixture.command("requestWithdrawal", SELLER, {
      id: "v3-fixture-held-withdrawal", assetId: TRON, amount: "25", destination: simulatedDestination(TRON, SELLER.id),
      stepUpReference: "sim-stepup-v3-fixture",
    })).result;
    historicalDispatch = walletCommand("beginDispatch", DISPATCHER, "v3-fixture-old-dispatch", withdrawal.id);
    await v1.execute(historicalDispatch);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: withdrawal.id, outcome: "unknown" });
  }
  const prefix1 = await v1.snapshot();
  const continuation2 = v2Command("continueFromV1", OPERATOR, "v3-fixture-continue-v2", {
    checkpoint: v3FixtureCheckpoint({ ...prefix1, lastCommandAtMs: clock }),
  });
  await upgradeDurableWalletV2({ mode: "simulation-only", store, command: continuation2,
    acknowledgeVersionUpgrade: true, clock: () => ++clock });
  const prefix = await createVersionedDurableWallet({ mode: "simulation-only", store }).snapshot();
  const prefixRows = await store.transaction(tx => v3FixtureHistory(tx));
  const continuation = v3Command("continueFromV2", OPERATOR, "v3-fixture-continue-v3", { checkpoint: v3FixtureCheckpoint(prefix) });
  await upgradeDurableWalletV3({ mode: "simulation-only", store, command: continuation,
    acknowledgeVersionUpgrade: true, clock: () => ++clock });
  const wallet = createV3DurableWallet({ mode: "simulation-only", store, clock: () => ++clock });
  const before = await wallet.snapshot();
  if (!isV3State(before.state)) throw new Error("The explicit fixture continuation did not produce v3");
  const facts = createV3InitialAcceptanceFixture({ mode: "simulation-only", state: before.state,
    walletRevision: before.revision, walletEventHash: before.eventHash, atMs: clock + 1,
    walletListingId: V3_FIXTURE_LISTING, walletTradeId: V3_FIXTURE_TRADE, platformRequestId: V3_FIXTURE_REQUEST,
    buyerId: BUYER.id, amount: "200", retainedPrice: "3.10" });
  const acceptance = v3Command("acceptInitialSellerRequest", SELLER, "v3-fixture-seller-accept", initialInputFromPlan(facts.plan));
  const execution = options.accept === false ? undefined : await wallet.execute(acceptance);
  if (options.pause) await wallet.execute(v3Command("pause", OPERATOR, "v3-fixture-source-pause", null));
  return { wallet, prefix, prefixRows, before, facts, continuation, acceptance, execution, historicalDispatch,
    snapshot: await wallet.snapshot(), now: () => clock };
}
