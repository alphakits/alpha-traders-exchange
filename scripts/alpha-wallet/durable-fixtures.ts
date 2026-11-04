import { assetFor, parseUnits, type AssetId } from "../../src/lib/alpha-wallet/amounts";
import { walletCommand, type DurableWallet } from "../../src/lib/alpha-wallet/durable";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { Actor, DepositPurpose } from "../../src/lib/alpha-wallet/types";
import type { CommandOf, WalletCommandType } from "../../src/lib/alpha-wallet/commands";

export const FIXTURE_TIME = 1_800_000_000_000;
export const SELLER: Actor = { kind: "seller", id: "fixture-seller" };
export const BUYER: Actor = { kind: "buyer", id: "fixture-buyer" };
export const OPERATOR: Actor = { kind: "operator", id: "fixture-operator" };
export const VERIFIER: Actor = { kind: "verifier", id: "fixture-verifier" };
export const DISPATCHER: Actor = { kind: "dispatcher", id: "fixture-dispatcher" };
export const TRON: AssetId = "tron-sim-usdt";

/** Offline fixture commands shared by the executable demo and storage recovery tests. */
export function durableFixture(wallet: DurableWallet, assetId: AssetId = TRON) {
  let sequence = 0;
  const request = (label: string) => `${label}-${++sequence}`;
  async function command<T extends WalletCommandType>(type: T, actor: Actor, input: CommandOf<T>["input"], requestId = request(type)) {
    return wallet.execute(walletCommand(type, actor, requestId, input));
  }
  async function deposit(amount: string, purpose: DepositPurpose = "principal", id = request("deposit")) {
    const created = await command("createDepositIntent", SELLER, { id, assetId, purpose });
    const asset = assetFor(assetId);
    const event = { intentId: id, assetId, network: asset.network, token: asset.token, transactionId: `sim-tx-${id}`, eventIndex: 0,
      destination: created.result.destination, amountRaw: parseUnits(amount, asset.decimals).toString(), blockHash: "sim-block-fixture", finalized: true, successful: true };
    await command("observeDeposit", VERIFIER, event);
    return { intent: created.result, event };
  }
  async function fundedListing(amount = "500", id = request("listing")) {
    await deposit(amount);
    await command("createListing", SELLER, { id, assetId, amount, price: "3.20", currency: "ILS" });
    await command("approveListing", OPERATOR, id);
    return id;
  }
  async function ready() {
    const state = (await wallet.snapshot()).state;
    const { expectedCustody } = await import("../../src/lib/alpha-wallet/ledger");
    await command("reconcileAsset", VERIFIER, { assetId, observedRaw: expectedCustody(state, assetId).toString(), complete: true });
    await command("setNativeFeeReadiness", OPERATOR, { assetId, ready: true });
  }
  async function queuedTrade(amount = "200", listingId?: string, id = request("trade")) {
    const listing = listingId ?? await fundedListing();
    const reserved = await command("reserveTrade", BUYER, { id, listingId: listing, amount, destination: simulatedDestination(assetId, BUYER.id) });
    await command("markBuyerPaid", BUYER, id);
    await command("verifyPayment", VERIFIER, { tradeId: id, evidence: { reference: `sim-evidence-${id}`, amountMinor: reserved.result.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } });
    await command("authorizeRelease", SELLER, id);
    await ready();
    return (await command("queueRelease", DISPATCHER, id)).result;
  }
  return { command, deposit, fundedListing, ready, queuedTrade, request, assetId };
}
