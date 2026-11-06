import { assetFor, parseUnits, type AssetId } from "../../src/lib/alpha-wallet/amounts";
import { applyWalletCommand, walletDigest, walletJson } from "../../src/lib/alpha-wallet/commands";
import { walletCommand } from "../../src/lib/alpha-wallet/durable";
import { createAlphaWalletSandbox } from "../../src/lib/alpha-wallet/sandbox";
import type { State } from "../../src/lib/alpha-wallet/types";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { applyV2Command, type V2State } from "../../src/lib/alpha-wallet/v2-engine";
import { initialInputFromPlan, v3Command } from "../../src/lib/alpha-wallet/v3-commands";
import { applyV3Command, isV3State, type V3State } from "../../src/lib/alpha-wallet/v3-engine";
import { createV3InitialAcceptanceFixture } from "../../src/lib/alpha-wallet/v3-fixtures";
import { v4Command } from "../../src/lib/alpha-wallet/v4-commands";
import { applyV4Command, type V4State } from "../../src/lib/alpha-wallet/v4-engine";
import { v5Command, v5CommandKey, type V5Command, type V5VersionedCommand } from "../../src/lib/alpha-wallet/v5-commands";
import { applyV5Command, type V5State } from "../../src/lib/alpha-wallet/v5-engine";
import { BUYER, FIXTURE_TIME, OPERATOR, SELLER, VERIFIER } from "./durable-fixtures";
import { V3_FIXTURE_LISTING, V3_FIXTURE_REQUEST, V3_FIXTURE_TRADE } from "./v3-durable-fixtures";

/** Synthetic in-memory histories. Independent frozen evidence is consumed separately. */
export function createV5EngineFixture(options: {
  assetId?: AssetId; amount?: string; method?: "Bank Transfer" | "Face-to-Face (Meet in Person)";
  sourcePaused?: boolean; continue?: boolean;
} = {}) {
  let at = FIXTURE_TIME;
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => at });
  let state: State | V2State | V3State | V4State | V5State = wallet.snapshot();
  let head = { revision: 0, eventHash: "0".repeat(64), stateHash: walletDigest(state), lastCommandAtMs: 0 };
  const records: Array<Record<string, unknown>> = [];
  const step = (command: V5VersionedCommand) => {
    const beforeHash = walletDigest(state); at++;
    const applied = command.version === 1 ? { result: applyWalletCommand(wallet, command), state: wallet.snapshot() }
      : command.version === 2 ? applyV2Command(state as State | V2State, command, { ...head, at })
        : command.version === 3 ? applyV3Command(state as State | V2State | V3State, command, { ...head, at })
          : command.version === 4 ? applyV4Command(state as State | V2State | V3State | V4State, command, { ...head, at })
            : applyV5Command(state, command, { ...head, at });
    state = applied.state;
    if (walletDigest(state) !== beforeHash) {
      const revision = head.revision + 1, commandKey = v5CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(applied.result), stateHash = walletDigest(state);
      const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: head.eventHash });
      records.push({ revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(at), command_json: structuredClone(command),
        input_hash: inputHash, result_json: walletJson(applied.result), result_hash: resultHash, state_hash: stateHash,
        previous_event_hash: head.eventHash, event_hash: eventHash });
      head = { revision, eventHash, stateHash, lastCommandAtMs: at };
    }
    return applied.result;
  };
  const assetId = options.assetId ?? "tron-sim-usdt", asset = assetFor(assetId);
  step(walletCommand("createListing", SELLER, "v5-test-listing", { id: V3_FIXTURE_LISTING, assetId, amount: "500", price: "3.20", currency: "ILS" }));
  step(walletCommand("approveListing", OPERATOR, "v5-test-approve", V3_FIXTURE_LISTING));
  const intent = step(walletCommand("createDepositIntent", SELLER, "v5-test-intent", { id: "v5-test-funding", assetId, purpose: "principal" })) as { destination: string };
  step(walletCommand("observeDeposit", VERIFIER, "v5-test-funding", { intentId: "v5-test-funding", assetId, network: asset.network, token: asset.token,
    destination: intent.destination, transactionId: "sim-tx-v5-funding", eventIndex: 0, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-v5-funding", finalized: true, successful: true }));
  step(v2Command("continueFromV1", OPERATOR, "v5-test-v2", { checkpoint: { ...head } }));
  step(v3Command("continueFromV2", OPERATOR, "v5-test-v3", { checkpoint: { ...head } }));
  if (!isV3State(state)) throw new Error("Expected initial V3 fixture");
  const facts = createV3InitialAcceptanceFixture({ mode: "simulation-only", state, walletRevision: head.revision, walletEventHash: head.eventHash,
    atMs: at + 1, walletListingId: V3_FIXTURE_LISTING, walletTradeId: V3_FIXTURE_TRADE, platformRequestId: V3_FIXTURE_REQUEST,
    platformTradeId: "v5-test-platform-trade", buyerId: BUYER.id, amount: options.amount ?? "200", retainedPrice: "3.10", paymentMethod: options.method });
  step(v3Command("acceptInitialSellerRequest", SELLER, "v5-test-acceptance", initialInputFromPlan(facts.plan)));
  step(v4Command("continueFromV3", OPERATOR, "v5-test-v4", { checkpoint: { ...head } }));
  if (options.sourcePaused) step(v4Command("pause", OPERATOR, "v5-test-source-pause", null));
  const source = structuredClone(state) as unknown as V4State, sourceHead = { ...head };
  const continuation = v5Command("continueFromV4", OPERATOR, "v5-test-upgrade", { checkpoint: sourceHead });
  if (options.continue !== false) step(continuation);
  return { source, sourceHead, continuation, step, records, assetId,
    get state() { return state as V5State; }, get at() { return at; },
    checkpoint: () => ({ ...head, stateHash: walletDigest(state) }),
    snapshot: () => ({ revision: head.revision, eventHash: head.eventHash, lastCommandAtMs: head.lastCommandAtMs, occurredAtMs: head.lastCommandAtMs,
      engineVersion: (state as V5State).engineVersion, state: structuredClone(state) as V5State }),
    apply(command: V5Command, time = at + 1) { return applyV5Command(state, command, { ...head, stateHash: walletDigest(state), at: time }); },
  };
}
