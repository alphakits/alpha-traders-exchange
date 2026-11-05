// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v4FixtureCancellationInput } from "../../../scripts/alpha-wallet/v4-durable-fixtures";
import { walletDigest, walletJson } from "./commands";
import { balance } from "./ledger";
import type { Actor, State } from "./types";
import { v2Command, type V2Checkpoint } from "./v2-commands";
import { v3Command } from "./v3-commands";
import { verifyV3History } from "./v3-durable";
import { assertV3Invariants, isV3State } from "./v3-engine";
import { v4Command, v4CommandKey, type V4Command } from "./v4-commands";
import { verifyV4History } from "./v4-durable";
import { applyV4Command, assertV4Invariants, baseV3StateForV4, isV4State } from "./v4-engine";
import { v4ProjectionDelta } from "./v4-projections";

type CapturedRow = Record<string, unknown> & {
  revision: number; command_key: string; command_type: string; occurred_at_ms: string; command_json: unknown;
  input_hash: string; result_json: unknown; result_hash: string; state_hash: string; previous_event_hash: string; event_hash: string;
};
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as { commands: CapturedRow[] };
const captured1 = read("v1/settlement-and-held-withdrawal.backup.json"), captured2 = read("v2/corrections-and-settlement.backup.json");
// These independent V3 bytes are pinned separately by v3-frozen-history.test.ts.
// This suite appends new V4 events; it never regenerates a historical expectation.
const captured = read("v3/initial-acceptance.history.json"), paused = read("v3/initial-acceptance.backup.json");
const originalState: unknown = JSON.parse(readFileSync(new URL("./fixtures/v3/initial-acceptance.state.json", import.meta.url), "utf8"));
const SOURCE: V2Checkpoint = { revision: 14, eventHash: "846e734f1ea118575af2ec1b7199005f9c0c3d1c1188338dc80ff4f056370223",
  stateHash: "e9254bd9ba4e80879aab5641dead516a0076f8b5d951bbeab9ec7f35341bf2f5", lastCommandAtMs: 1_800_000_000_014 };
const OPERATOR: Actor = { kind: "operator", id: "frozen-v4-owner" };
const TRON = "tron-sim-usdt", TRADE = "v3-fixture-trade", LISTING = "v3-fixture-listing", WITHDRAWAL = "withdrawal-v3-fixture-held-withdrawal";
function checkpoint(snapshot: { revision: number; eventHash: string; lastCommandAtMs: number; state: State }): V2Checkpoint {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
}
function append(records: readonly CapturedRow[], command: V4Command, at: number) {
  const before = verifyV4History(records), previous = checkpoint(before), applied = applyV4Command(before.state, command, { ...previous, at });
  const revision = previous.revision + 1, commandKey = v4CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: previous.eventHash });
  const row: CapturedRow = { revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(at), command_json: command,
    input_hash: inputHash, result_json: walletJson(applied.result), result_hash: resultHash, state_hash: stateHash, previous_event_hash: previous.eventHash, event_hash: eventHash };
  return { before, applied, row, records: [...structuredClone(records), row] };
}
function continued(prefix = captured.commands) {
  const source = verifyV4History(prefix), point = checkpoint(source);
  return append(prefix, v4Command("continueFromV3", OPERATOR, "frozen-v4-continuation", { checkpoint: point }), point.lastCommandAtMs + 1);
}
function cancelled() {
  const continuation = continued(), before = verifyV4History(continuation.records);
  if (!isV4State(before.state)) throw new Error("Expected explicit V4 continuation");
  const actor: Actor = { kind: "buyer", id: before.state.trades.get(TRADE)!.buyerId }, at = before.lastCommandAtMs + 1;
  const command = v4Command("cancelInitialTrade", actor, "frozen-v4-buyer-cancellation", v4FixtureCancellationInput(before, at, actor.id));
  return { continuation, command, ...append(continuation.records, command, at) };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("v4 preserves every independently frozen history", () => {
  it.each([{ name: "v1", captured: captured1 }, { name: "v2", captured: captured2 }, { name: "v3", captured }])(
    "retains each original $name checkpoint under the unchanged historical reducers", ({ captured: original }) => {
      for (const row of original.commands) {
        const prefix = original.commands.slice(0, row.revision), replayed = verifyV4History(prefix);
        expect(checkpoint(replayed)).toEqual({ revision: row.revision, eventHash: row.event_hash, stateHash: row.state_hash, lastCommandAtMs: Number(row.occurred_at_ms) });
        expect(replayed).toEqual(verifyV3History(prefix));
      }
    });
  it("continues the original unpaused V3 checkpoint and leaves held payout, accepted terms and accounting unchanged", () => {
    const f = continued(), snapshot = verifyV4History(f.records);
    expect(checkpoint(f.before)).toEqual(SOURCE); expect(walletJson(f.before.state)).toEqual(originalState);
    expect(f.records.slice(0, 14)).toEqual(captured.commands);
    if (!isV4State(snapshot.state)) throw new Error("Expected V4");
    expect(walletJson(baseV3StateForV4(snapshot.state))).toEqual(originalState);
    expect(snapshot.state.journal).toEqual(f.before.state.journal);
    expect(snapshot.state.payouts.get(WITHDRAWAL)).toEqual(f.before.state.payouts.get(WITHDRAWAL));
    expect(snapshot.state.payouts.get(WITHDRAWAL)).toMatchObject({ state: "submission_unknown", dispatchCount: 1 });
    expect(balance(snapshot.state, TRON, `payout:${WITHDRAWAL}`)).toBe(BigInt("25000000"));
    expect(snapshot.state.cancellationContinuation.sourceHaltReason).toBeNull(); assertV4Invariants(snapshot.state);
  });
  it("cancels the current trade while reconstructing the original still-reserved V3 state byte-for-byte", () => {
    const f = cancelled(), snapshot = verifyV4History(f.records);
    if (!isV4State(snapshot.state)) throw new Error("Expected V4");
    const original = baseV3StateForV4(snapshot.state);
    expect(walletJson(original)).toEqual(originalState); expect(walletDigest(original)).toBe(SOURCE.stateHash);
    expect(snapshot.state.trades.get(TRADE)!.status).toBe("cancelled"); expect(original.trades.get(TRADE)!.status).toBe("reserved");
    expect(balance(snapshot.state, TRON, `listing:${LISTING}`)).toBe(BigInt("500000000"));
    expect(balance(original, TRON, `listing:${LISTING}`)).toBe(BigInt("300000000"));
    expect(snapshot.state.initialBindings).toEqual(original.initialBindings);
    expect(snapshot.state.initialAcceptanceReceipts).toEqual(original.initialAcceptanceReceipts);
    expect(snapshot.state.payouts).toEqual(original.payouts); expect(snapshot.state.commissions).toEqual(original.commissions);
    expect(f.records.slice(0, 14)).toEqual(captured.commands); assertV3Invariants(original); assertV4Invariants(snapshot.state);
    expect(() => verifyV3History(f.records)).toThrow();
    expect(verifyV3History(f.records.slice(0, 14))).toEqual(verifyV3History(captured.commands));
  });
  it("adds only the new cancellation journal/entries and receipt to retained projections", () => {
    const f = cancelled(), delta = v4ProjectionDelta(f.before.state, f.applied.state, f.row.revision);
    expect(delta.journals).toHaveLength(1); expect(delta.entries).toHaveLength(2); expect(delta.initialCancellations).toHaveLength(1);
    for (const [key, rows] of Object.entries(delta)) if (!["journals", "entries", "initialCancellations"].includes(key)) expect(rows, key).toEqual([]);
    expect(delta.entries.map(row => [row.account, row.delta_units])).toEqual([[`trade:${TRADE}`, "-200000000"], [`listing:${LISTING}`, "200000000"]]);
  });
  it("does not turn a frozen paused V3 history into cancellation authority", () => {
    const f = continued(paused.commands), snapshot = verifyV4History(f.records);
    if (!isV4State(snapshot.state)) throw new Error("Expected V4");
    expect(snapshot.state.haltReason).toBe("Operator emergency pause");
    const trade = snapshot.state.trades.get(TRADE)!, actor: Actor = { kind: "seller", id: trade.sellerId }, at = snapshot.lastCommandAtMs + 1;
    const command = v4Command("cancelInitialTrade", actor, "never-resume", v4FixtureCancellationInput(snapshot, at, actor.id));
    expect(() => applyV4Command(snapshot.state, command, { ...checkpoint(snapshot), at })).toThrow("paused");
    expect(baseV3StateForV4(snapshot.state)).toEqual(verifyV3History(paused.commands).state);
  });
  it("refuses to execute any newly appended old version after the explicit V4 continuation", () => {
    for (const command of [v2Command("pause", OPERATOR, "new-v2", null), v3Command("pause", OPERATOR, "new-v3", null)]) {
      const f = continued(), row = structuredClone(f.row);
      row.revision++; row.command_json = command; row.command_key = v4CommandKey(command); row.command_type = command.type; row.input_hash = walletDigest(command);
      row.previous_event_hash = f.row.event_hash; row.occurred_at_ms = String(Number(f.row.occurred_at_ms) + 1);
      expect(() => verifyV4History([...f.records, row])).toThrow("recorded engine");
    }
  });
  it.each(["input_hash", "result_hash", "state_hash", "event_hash", "previous_event_hash"] as const)(
    "cannot conceal altered original V3 %s behind a valid V4 tail", field => {
      const f = cancelled(); f.records[SOURCE.revision - 1]![field] = "e".repeat(64); expect(() => verifyV4History(f.records)).toThrow();
    });
  it("does not recast original seller acceptance as a buyer cancellation or accept a relabelled continuation", () => {
    const f = cancelled(), sourceRow = f.records[SOURCE.revision - 1]!;
    const original = sourceRow.command_json as { actor: Actor };
    sourceRow.command_json = { ...original, actor: { kind: "buyer", id: original.actor.id } };
    sourceRow.input_hash = walletDigest(sourceRow.command_json); expect(() => verifyV4History(f.records)).toThrow();
    const g = continued(), command = g.row.command_json as V4CommandOfContinuation;
    command.input.checkpoint.eventHash = "f".repeat(64); g.row.input_hash = walletDigest(command);
    expect(() => verifyV4History(g.records)).toThrow();
  });
  it("keeps V3 invariants frozen rather than admitting a cancelled initial trade into the old state", () => {
    const f = cancelled(), original = verifyV3History(captured.commands).state;
    if (!isV3State(original)) throw new Error("Expected original V3");
    original.trades.get(TRADE)!.status = "cancelled";
    expect(() => assertV3Invariants(original)).toThrow();
    expect(() => assertV4Invariants(f.applied.state)).not.toThrow();
  });
});
type V4CommandOfContinuation = Extract<V4Command, { type: "continueFromV3" }>;
