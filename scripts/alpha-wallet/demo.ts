/** Run: NODE_ENV=development node --import tsx scripts/alpha-wallet/demo.ts */
import { strict as assert } from "node:assert";
import { assetFor, formatUnits, parseUnits, type AssetId } from "../../src/lib/alpha-wallet/amounts";
import { createAlphaWalletSandbox, simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { Actor } from "../../src/lib/alpha-wallet/types";

const assetId: AssetId = "tron-sim-usdt";
const asset = assetFor(assetId);
const seller: Actor = { kind: "seller", id: "demo-seller" };
const buyer: Actor = { kind: "buyer", id: "demo-buyer" };
const operator: Actor = { kind: "operator", id: "demo-owner" };
const verifier: Actor = { kind: "verifier", id: "demo-verifier" };
const dispatcher: Actor = { kind: "dispatcher", id: "demo-worker" };
const wallet = createAlphaWalletSandbox({ mode: "simulation-only" });
const checkpoints: Array<Record<string, unknown>> = [];
function capture(stage: string) {
  const listing = wallet.getListing("demo-listing");
  checkpoints.push({ stage, listing: listing.status, availableUSDT: formatUnits(listing.availableRaw, asset.decimals),
    expectedCustodyUSDT: formatUnits(wallet.expectedCustody(assetId), asset.decimals) });
}
function deposit(id: string, purpose: "principal" | "commission", amount: string) {
  const intent = wallet.createDepositIntent(seller, `${id}-intent`, { id, assetId, purpose });
  const event = { intentId: id, assetId, network: asset.network, token: asset.token, transactionId: `sim-tx-${id}`, eventIndex: 0,
    destination: intent.destination, amountRaw: parseUnits(amount, asset.decimals).toString(), blockHash: `sim-block-${id}`, successful: true };
  wallet.observeDeposit(verifier, `${id}-pending`, { ...event, finalized: false });
  if (purpose === "principal") capture("Deposit observed; waiting for finality");
  wallet.observeDeposit(verifier, `${id}-final`, { ...event, finalized: true });
  assert.equal(wallet.observeDeposit(verifier, `${id}-duplicate`, { ...event, finalized: true }).credited, false);
}
wallet.createListing(seller, "create-listing", { id: "demo-listing", assetId, amount: "500", price: "3.75", currency: "ILS" });
wallet.approveListing(operator, "approve-listing", "demo-listing");
capture("Owner approved; no confirmed principal");
deposit("demo-principal", "principal", "500");
capture("Confirmed 500 USDT principal; listing active");
deposit("demo-commission", "commission", "10");

for (const [index, amount] of ["200", "300"].entries()) {
  const tradeId = `demo-trade-${index + 1}`;
  const trade = wallet.reserveTrade(buyer, `${tradeId}-reserve`, { id: tradeId, listingId: "demo-listing", amount, destination: simulatedDestination(assetId, buyer.id) });
  wallet.markBuyerPaid(buyer, `${tradeId}-paid`, tradeId);
  assert.throws(() => wallet.authorizeRelease(seller, `${tradeId}-early-release`, tradeId), /verified/);
  wallet.verifyPayment(verifier, `${tradeId}-verified`, { tradeId, evidence: { reference: `sim-evidence-${tradeId}`, amountMinor: trade.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } });
  wallet.authorizeRelease(seller, `${tradeId}-authorize`, tradeId);
  wallet.reconcileAsset(verifier, `${tradeId}-reconcile`, { assetId, observedRaw: wallet.expectedCustody(assetId).toString(), complete: true });
  wallet.setNativeFeeReadiness(operator, `${tradeId}-gas`, { assetId, ready: true });
  const payout = wallet.queueRelease(dispatcher, `${tradeId}-queue`, tradeId);
  assert.equal(wallet.beginDispatch(dispatcher, `${tradeId}-dispatch`, payout.id).shouldDispatch, true);
  wallet.recordSubmission(dispatcher, `${tradeId}-unknown`, { payoutId: payout.id, outcome: "unknown" });
  assert.equal(wallet.beginDispatch(dispatcher, `${tradeId}-dispatch`, payout.id).shouldDispatch, false);
  assert.throws(() => wallet.beginDispatch(dispatcher, `${tradeId}-new-dispatch`, payout.id), /already dispatched/);
  wallet.confirmPayout(verifier, `${tradeId}-receipt`, { payoutId: payout.id, providerReference: payout.providerReference,
    assetId, network: asset.network, token: asset.token, transactionId: `sim-tx-outgoing-${index + 1}`, eventIndex: 0,
    destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true });
  capture(`Buyer receives full ${amount} USDT; separate commission settles`);
}
assert.equal(wallet.getListing("demo-listing").availableRaw, BigInt(0));
assert.equal(wallet.getBalance(assetId, "platform-revenue"), parseUnits("10", asset.decimals));
assert.equal(wallet.expectedCustody(assetId), parseUnits("10", asset.decimals));
assert.equal(wallet.assertInvariants(), true);
console.log(JSON.stringify({ mode: "OFFLINE SIMULATION ONLY — no real funds, chain calls, keys, or payouts", checkpoints,
  totals: { principalDepositedUSDT: "500", principalDeliveredUSDT: "500", separateCommissionDepositedUSDT: "10", commissionRecognizedUSDT: "10", remainingCustomerPrincipalUSDT: "0" },
  protectionsExercised: ["unconfirmed deposit cannot activate", "duplicate deposit cannot credit again", "buyer claim cannot authorize release", "unknown payout retains original intent", "duplicate dispatch claim cannot send again", "principal conserved", "fees remain separate"],
}, null, 2));
