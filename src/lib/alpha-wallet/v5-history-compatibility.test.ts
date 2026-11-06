// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, OPERATOR } from "../../../scripts/alpha-wallet/durable-fixtures";
import { V3_FIXTURE_TRADE, v3FixtureCheckpoint } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { v5FixtureClaimInput, v5FixtureDisputeInput } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { walletDigest, walletJson } from "./commands";
import { inspectV4WalletBackup } from "./v4-backup";
import { verifyV4History } from "./v4-durable";
import { assertV4Invariants } from "./v4-engine";
import { v5Command, v5CommandKey, type V5Command } from "./v5-commands";
import { verifyV5History } from "./v5-durable";
import { applyV5Command, baseV4StateForV5, isV5State } from "./v5-engine";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const read = (name: string) => readFileSync(new URL(`./fixtures/v4/${name}`, import.meta.url), "utf8");
const provenanceText = read("provenance.json"), provenance = JSON.parse(provenanceText) as {
  sourceCommit: string; sourceTree: string; sourceSha256: Record<string, string>; files: Record<string, { bytes: number; sha256: string }>;
};
const expectedFiles = {
  "accepted.history.json": "25cda643febf72cdfef4565a5b5c0ec97b39384d192126e78b814c409ad16566",
  "accepted.state.json": "bb071ad3b0ab337782778deba620563d771f2d24a6eea5bd92614bb395d5db00",
  "accepted.backup.json": "ec8aa8478c484d7ad927bc9768640455e4a9845f46dadbbcf0d3049b67ca447a",
  "cancelled.history.json": "8f9a08aa3804d5684ac15064fb9152e61f5fcd25ac651a9c354d06e7b38b1f73",
  "cancelled.state.json": "28f7d16c17365b31f021aa482db475e13b6a7ebd549b7b4df9c17f86e7539e2a",
  "cancelled.backup.json": "e6f95b5f47233c9d7772713bff740b22900b5fca38163656ade5139ad83d3074",
};
const frozenContracts = ["commands.ts", "types.ts", "amounts.ts", "ledger.ts", "sandbox.ts", "durable-store.ts", "durable.ts",
  "v2-commands.ts", "v2-engine.ts", "v2-kernel.ts", "versioned-durable.ts", "versioned-projections.ts",
  "v3-commands.ts", "v3-engine.ts", "v3-durable.ts", "v3-projections.ts", "v3-backup.ts",
  "v4-commands.ts", "v4-engine.ts", "v4-durable.ts", "v4-projections.ts", "v4-backup.ts"].map(name => `src/lib/alpha-wallet/${name}`)
  .concat(["docs/alpha-wallet/durable-schema.sql", "docs/alpha-wallet/durable-v2-migration.sql", "docs/alpha-wallet/durable-v3-migration.sql", "docs/alpha-wallet/durable-v4-migration.sql"]);
function captured(variant: "accepted" | "cancelled", paused = false) {
  return JSON.parse(read(`${variant}.${paused ? "backup" : "history"}.json`)) as { commands: Array<Record<string, unknown>>; checkpoint: unknown };
}
function append(rows: Array<Record<string, unknown>>, command: V5Command, at: number) {
  const before = verifyV5History(rows), applied = applyV5Command(before.state, command, { ...v3FixtureCheckpoint(before), at });
  const revision = before.revision + 1, commandKey = v5CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: before.eventHash });
  const next = [...structuredClone(rows), { revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(at),
    command_json: command, input_hash: inputHash, result_json: walletJson(applied.result), result_hash: resultHash, state_hash: stateHash,
    previous_event_hash: before.eventHash, event_hash: eventHash }];
  return { rows: next, snapshot: verifyV5History(next) };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("V5 independently frozen V4 compatibility", () => {
  it("pins independently captured predecessor bytes and unchanged V1–V4 financial contracts", () => {
    expect(hash(provenanceText)).toBe("6df46fce990671d46e518e56c2423aca76ce118ffa375a9ca2b2c5ef269f1333");
    expect(provenance.sourceCommit).toBe("26ac313212071c3ca600ad19dfb72cac234c0ef0");
    expect(provenance.sourceTree).toBe("3254c852ba07dac2af9989bbba763b07f4b14727");
    expect(Object.keys(provenance.sourceSha256)).toHaveLength(101);
    for (const [name, expected] of Object.entries(expectedFiles)) {
      const content = read(name); expect(hash(content), name).toBe(expected);
      expect(provenance.files[name]).toEqual({ bytes: Buffer.byteLength(content), sha256: expected });
    }
    for (const path of frozenContracts) expect(hash(readFileSync(new URL(`../../../${path}`, import.meta.url))), path).toBe(provenance.sourceSha256[path]);
    // V2 backup is not imported by the V4 capture's export path. Its separate
    // hash is pinned directly to the same verified predecessor Git object.
    expect(hash(readFileSync(new URL("./versioned-backup.ts", import.meta.url)))).toBe("7d429d4e09a02f225069d12ce9e391275856d895594e9f673ac66cf66e93fa2d");
  });
  it.each(["accepted", "cancelled"] as const)("replays every original %s checkpoint under the unchanged original reducers", variant => {
    const original = captured(variant), backup = captured(variant, true);
    for (let index = 1; index <= backup.commands.length; index++) expect(verifyV5History(backup.commands.slice(0, index))).toEqual(verifyV4History(backup.commands.slice(0, index)));
    const source = verifyV5History(original.commands); expect(v3FixtureCheckpoint(source)).toEqual(original.checkpoint);
    expect(walletJson(source.state)).toEqual(JSON.parse(read(`${variant}.state.json`)));
    expect(backup.commands.slice(0, original.commands.length)).toEqual(original.commands);
    expect(inspectV4WalletBackup(read(`${variant}.backup.json`))).toMatchObject({ formatVersion: 4, sourcePaused: true,
      initialCancellationCount: variant === "cancelled" ? 1 : 0 });
  });
  it.each(["accepted", "cancelled"] as const)("continues %s while retaining exact original history and held unknown withdrawal", variant => {
    const original = captured(variant), source = verifyV4History(original.commands);
    const continued = append(original.commands, v5Command("continueFromV4", OPERATOR, `frozen-v5-${variant}`, { checkpoint: v3FixtureCheckpoint(source) }), source.lastCommandAtMs + 1);
    if (!isV5State(continued.snapshot.state)) throw new Error("V5 required");
    expect(continued.rows.slice(0, source.revision)).toEqual(original.commands);
    expect(baseV4StateForV5(continued.snapshot.state)).toEqual(source.state);
    expect(continued.snapshot.state.payouts).toEqual(source.state.payouts);
    expect(continued.snapshot.state.payouts.get("withdrawal-v3-fixture-held-withdrawal")).toMatchObject({ state: "submission_unknown", dispatchCount: 1 });
    const claim = v5Command("claimInitialPayment", BUYER, `frozen-v5-${variant}-claim`, v5FixtureClaimInput(continued.snapshot, continued.snapshot.lastCommandAtMs + 1));
    if (variant === "cancelled") {
      expect(() => append(continued.rows, claim, claim.input.claimedAtMs)).toThrow(/cancelled/);
      expect(continued.snapshot.state.trades.get(V3_FIXTURE_TRADE)!.status).toBe("cancelled");
    } else {
      const claimed = append(continued.rows, claim, claim.input.claimedAtMs);
      const dispute = v5Command("freezeInitialDispute", BUYER, "frozen-v5-dispute", v5FixtureDisputeInput(claimed.snapshot, claimed.snapshot.lastCommandAtMs + 1));
      const frozen = append(claimed.rows, dispute, dispute.input.disputedAtMs);
      if (!isV5State(frozen.snapshot.state)) throw new Error("V5 required");
      expect(frozen.snapshot.state.accounts).toEqual(source.state.accounts); expect(frozen.snapshot.state.journal).toEqual(source.state.journal);
      expect(baseV4StateForV5(frozen.snapshot.state)).toEqual(source.state); assertV4Invariants(baseV4StateForV5(frozen.snapshot.state));
    }
  });
  it.each(["accepted", "cancelled"] as const)("preserves the paused %s source without treating continuation as a resume", variant => {
    const original = captured(variant, true), source = verifyV4History(original.commands);
    const continued = append(original.commands, v5Command("continueFromV4", OPERATOR, `paused-${variant}-v5`, { checkpoint: v3FixtureCheckpoint(source) }), source.lastCommandAtMs + 1);
    expect(continued.snapshot.state.haltReason).toBe(source.state.haltReason);
    const claim = v5Command("claimInitialPayment", BUYER, "never-resume", v5FixtureClaimInput(continued.snapshot, continued.snapshot.lastCommandAtMs + 1));
    expect(() => append(continued.rows, claim, claim.input.claimedAtMs)).toThrow(/paused/);
  });
  it.each(["input_hash", "result_hash", "state_hash", "event_hash", "previous_event_hash"])("cannot hide altered original %s behind valid V5 metadata", field => {
    const original = captured("accepted"), source = verifyV4History(original.commands);
    const continued = append(original.commands, v5Command("continueFromV4", OPERATOR, "frozen-v5", { checkpoint: v3FixtureCheckpoint(source) }), source.lastCommandAtMs + 1);
    continued.rows[13]![field] = "f".repeat(64); expect(() => verifyV5History(continued.rows)).toThrow();
  });
});
