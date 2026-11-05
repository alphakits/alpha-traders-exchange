// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walletDigest, walletJson } from "./commands";
import { createFileWalletStore, type WalletStore } from "./durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import type { Actor, State } from "./types";
import { parseVersionedCommand, v2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION, type V2Checkpoint } from "./v2-commands";
import { isV2State } from "./v2-engine";
import { exportVersionedWalletBackup, restoreVersionedWalletBackup } from "./versioned-backup";
import { createVersionedDurableWallet, verifyVersionedHistory } from "./versioned-durable";
import { parseV3Command, parseV3VersionedCommand, v3Command, v3CommandKey, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { applyV3Command, assertV3Invariants, isV3State } from "./v3-engine";
import { createV3DurableWallet, upgradeDurableWalletV3, verifyV3History } from "./v3-durable";

// These bytes were captured once by the prior milestone, from verified v2
// source. The v3 tests consume them; they never recapture their own expectations.
const backupText = readFileSync(new URL("./fixtures/v2/corrections-and-settlement.backup.json", import.meta.url), "utf8");
const stateText = readFileSync(new URL("./fixtures/v2/corrections-and-settlement.state.json", import.meta.url), "utf8");
const provenanceText = readFileSync(new URL("./fixtures/v2/provenance.json", import.meta.url), "utf8");
type CapturedRow = Record<string, unknown> & {
  revision: number; command_key: string; command_type: string; occurred_at_ms: string;
  command_json: unknown; input_hash: string; result_json: unknown; result_hash: string;
  state_hash: string; previous_event_hash: string; event_hash: string;
};
const captured = JSON.parse(backupText) as { commands: CapturedRow[] };
const capturedState: unknown = JSON.parse(stateText);
const provenance = JSON.parse(provenanceText) as { sourceCommit: string; sourceSha256: Record<string, string> };
const CHECKPOINT = { revision: 41, eventHash: "b61492df6398d0e3b1b3b71ea3b61e4d06ab8222189e1702cfb41d73bff3f020",
  stateHash: "5ef934b1da1a1481705e018e34462c8fad3b1169a3bbe5b1af0d70dac4c85872", lastCommandAtMs: 1_793_880_041_000 };
const BACKUP_CHECKSUM = "1f475d6f1c55ac1501ba1f415ff118018f7e4ab77d78c4328efc584f23111ad1";
const AT = 1_793_880_100_000;
const OWNER: Actor = { kind: "operator", id: "frozen-v3-owner" };
const SELLER: Actor = { kind: "seller", id: "frozen-v2-seller" };
const TRON = "tron-sim-usdt", BSC = "bsc-sim-binance-peg-usdt";
const WITHDRAWAL = "withdrawal-frozen-v2-held-withdrawal";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const LEGACY_CONTRACTS = [
  "src/lib/alpha-wallet/commands.ts", "src/lib/alpha-wallet/durable.ts", "src/lib/alpha-wallet/sandbox.ts",
  "src/lib/alpha-wallet/v2-commands.ts", "src/lib/alpha-wallet/v2-engine.ts", "src/lib/alpha-wallet/v2-kernel.ts",
  "src/lib/alpha-wallet/versioned-durable.ts", "src/lib/alpha-wallet/versioned-projections.ts",
  "src/lib/alpha-wallet/versioned-backup.ts", "docs/alpha-wallet/durable-schema.sql", "docs/alpha-wallet/durable-v2-migration.sql",
] as const;

function checkpoint(snapshot: { revision: number; eventHash: string; lastCommandAtMs: number; state: State }): V2Checkpoint {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
    lastCommandAtMs: snapshot.lastCommandAtMs };
}

/** Construct only a new command row; every captured predecessor stays untouched. */
function continuedHistory(prefix: readonly CapturedRow[] = captured.commands) {
  const previous = verifyV3History(prefix), source = checkpoint(previous);
  const command = v3Command("continueFromV2", OWNER, "frozen-v3-continuation", { checkpoint: source });
  const applied = applyV3Command(previous.state, command, { ...source, at: AT });
  const revision = source.revision + 1, commandKey = v3CommandKey(command), inputHash = walletDigest(command);
  const resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const eventHash = walletDigest({ revision, commandKey, at: AT, inputHash, resultHash, stateHash, previousHash: source.eventHash });
  const row: CapturedRow = { revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(AT),
    command_json: command, input_hash: inputHash, result_json: walletJson(applied.result), result_hash: resultHash,
    state_hash: stateHash, previous_event_hash: source.eventHash, event_hash: eventHash };
  return { previous, source, command, applied, row, records: [...structuredClone(prefix), row] };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("v3 preserves the independently captured financial history", () => {
  it("keeps the frozen v2 evidence and original engine/storage/backup contracts byte-for-byte", () => {
    expect(hash(backupText)).toBe("b649ac30737b4ea33523ae04f2db3f476357600d36d966f229d32299fab5d5bb");
    expect(hash(stateText)).toBe("ab9f897ec37291db953ee63eb2161adbc42a4ec086def7db80d927a47e1bfa02");
    expect(hash(provenanceText)).toBe("46cc3cf891507e89c78e6ad7b38be8535f95b29d15f1596afbe255f884069f74");
    expect(provenance.sourceCommit).toBe("47f0fc18f33c0f307da53726281db18055a76855");
    for (const path of LEGACY_CONTRACTS) {
      expect(hash(readFileSync(new URL(`../../../${path}`, import.meta.url))), path).toBe(provenance.sourceSha256[path]);
    }
  });

  it("verifies every original checkpoint under its original engine and retains the exact final tagged state", () => {
    for (const row of captured.commands) {
      const snapshot = verifyV3History(captured.commands.slice(0, row.revision));
      expect(checkpoint(snapshot)).toEqual({ revision: row.revision, eventHash: row.event_hash,
        stateHash: row.state_hash, lastCommandAtMs: Number(row.occurred_at_ms) });
      expect(snapshot).toEqual(verifyVersionedHistory(captured.commands.slice(0, row.revision)));
    }
    const original = verifyV3History(captured.commands);
    expect(checkpoint(original)).toEqual(CHECKPOINT);
    expect(walletJson(original.state)).toEqual(capturedState);
    expect(original.engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    expect(isV3State(original.state)).toBe(false);
  });

  it("continues the full settled/corrected prefix without rewriting accounting, consent, or unknown payout history", () => {
    const fixture = continuedHistory(), recovered = verifyV3History(fixture.records);
    expect(recovered.engineVersion).toBe(WALLET_V3_ENGINE_VERSION);
    expect(recovered.revision).toBe(42);
    expect(fixture.records.slice(0, 41)).toEqual(captured.commands);
    expect(isV3State(recovered.state)).toBe(true);
    if (!isV3State(recovered.state) || !isV2State(fixture.previous.state)) throw new Error("Expected explicit third engine continuation");
    const state = recovered.state;
    const { initialContinuation, initialBindings, initialAcceptanceReceipts, ...base } = state;
    expect(initialContinuation).toEqual({ checkpoint: CHECKPOINT, commandRevision: 42, commandKey: fixture.row.command_key });
    expect(initialBindings.size).toBe(0);
    expect(initialAcceptanceReceipts.size).toBe(0);
    expect(state.continuation).toEqual(fixture.previous.state.continuation);
    expect(state.termsBindings).toEqual(fixture.previous.state.termsBindings);
    expect(state.acceptanceReceipts).toEqual(fixture.previous.state.acceptanceReceipts);
    expect(state.idempotency.size).toBe(fixture.previous.state.idempotency.size + 1);
    for (const [key, receipt] of fixture.previous.state.idempotency) expect(state.idempotency.get(key), key).toEqual(receipt);
    expect(walletJson({ ...base, engineVersion: WALLET_V2_ENGINE_VERSION,
      idempotency: fixture.previous.state.idempotency })).toEqual(capturedState);
    expect(state.payouts.get(WITHDRAWAL)).toMatchObject({ state: "submission_unknown", dispatchCount: 1,
      amountRaw: BigInt("25000000"), providerReference: "sim-payout-withdrawal-frozen-v2-held-withdrawal" });
    expect(balance(state, TRON, `payout:${WITHDRAWAL}`)).toBe(BigInt("25000000"));
    expect(expectedCustody(state, TRON)).toBe(BigInt("355000000"));
    expect(expectedCustody(state, BSC)).toBe(BigInt("9019952000000000000"));
    assertV3Invariants(state); assertLedgerInvariants(state);
  });

  it.each([SELLER, OWNER])("refuses relabeling the historical buyer as $kind even after recomputing its command fingerprint", actor => {
    const rows = structuredClone(captured.commands), row = rows[4]!;
    const original = parseVersionedCommand(row.command_json);
    const forged = { ...original, actor };
    row.command_json = forged; row.command_key = versionedCommandKey(forged); row.input_hash = walletDigest(forged);
    expect(() => verifyV3History(rows)).toThrow();
    expect(hash(backupText)).toBe("b649ac30737b4ea33523ae04f2db3f476357600d36d966f229d32299fab5d5bb");
  });

  it.each([
    { revision: 18, field: "result_hash" },
    { revision: 19, field: "state_hash" },
    { revision: 21, field: "event_hash" },
    { revision: 29, field: "previous_event_hash" },
  ] as const)("does not let v3 continuation conceal changed v2 $field at revision $revision", ({ revision, field }) => {
    const fixture = continuedHistory();
    fixture.records[revision - 1]![field] = "e".repeat(64);
    expect(() => verifyV3History(fixture.records)).toThrow();
  });

  it("refuses an otherwise valid v3 continuation followed by a new command carrying the old v2 envelope", () => {
    const fixture = continuedHistory(captured.commands.slice(0, 17));
    // These are the untouched remaining historical records. Their presence
    // after the v3 boundary must not turn the old envelope into current authority.
    const remaining = structuredClone(captured.commands.slice(17));
    remaining[0]!.revision = fixture.row.revision + 1;
    remaining[0]!.previous_event_hash = fixture.row.event_hash;
    expect(() => verifyV3History([...fixture.records, ...remaining])).toThrow();
  });

  it("keeps the old v1/v2 reader closed to a valid new continuation", () => {
    const fixture = continuedHistory();
    expect(() => parseVersionedCommand(fixture.command)).toThrow();
    expect(() => verifyVersionedHistory(fixture.records)).toThrow();
  });

  it.each([
    { version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type: "reserveTrade" },
    { version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type: "acceptAmountCorrection" },
    { version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type: "enrollReservedTrade" },
    { version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type: "beginDispatch" },
    { version: 3, engineVersion: WALLET_V3_ENGINE_VERSION, type: "resume" },
    { version: 4, engineVersion: "alpha-wallet-simulation-v4", type: "pause" },
    { version: 3, engineVersion: WALLET_V2_ENGINE_VERSION, type: "pause" },
    { version: 2, engineVersion: WALLET_V3_ENGINE_VERSION, type: "pause" },
  ])("rejects unsupported current authority $type under $version / $engineVersion", envelope => {
    expect(() => parseV3VersionedCommand({ ...envelope, actor: OWNER, requestId: "v3-history-unsupported", input: null })).toThrow();
  });

  it("restores the old fixture, explicitly continues, reopens, and recovers original commands without renewed dispatch authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v3-frozen-history-"));
    const dataDir = join(directory, "wallet");
    let store: WalletStore | undefined;
    try {
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      const restored = await restoreVersionedWalletBackup({ mode: "simulation-only", store, backup: backupText,
        expectedChecksum: BACKUP_CHECKSUM, acknowledgeFreshTarget: true, clock: () => AT });
      const oldWallet = createVersionedDurableWallet({ mode: "simulation-only", store, clock: () => AT + 1 });
      const source = await oldWallet.snapshot();
      expect(source.state.haltReason).toBe("Operator emergency pause");
      expect(source.revision).toBe(42);
      expect(checkpoint(source)).toEqual(restored.restored);
      const command = v3Command("continueFromV2", OWNER, "v3-frozen-durable-continuation", { checkpoint: checkpoint(source) });
      const upgraded = await upgradeDurableWalletV3({ mode: "simulation-only", store, command,
        acknowledgeVersionUpgrade: true, clock: () => AT + 1 });
      expect(upgraded).toMatchObject({ revision: 43, replayed: false, commandKey: v3CommandKey(command) });
      await store.close(); store = undefined;
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      const wallet = createV3DurableWallet({ mode: "simulation-only", store, clock: () => AT + 2 });
      const before = await wallet.snapshot();
      expect(before.state.haltReason).toBe("Operator emergency pause");
      expect(before.revision).toBe(43);
      expect(isV3State(before.state)).toBe(true);
      const rows = await store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
        occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
        FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
      expect(rows.slice(0, 41)).toEqual(captured.commands);
      expect(rows).toHaveLength(43);
      expect(rows[41]).toMatchObject({ command_type: "pause", command_key: restored.quarantineCommandKey });
      expect(rows[42]).toMatchObject({ command_type: "continueFromV2", command_key: upgraded.commandKey, event_hash: upgraded.eventHash });
      expect(verifyV3History(rows)).toEqual(before);
      let dispatches = 0;
      for (const row of captured.commands) {
        const operation = parseV3VersionedCommand(row.command_json), receipt = await wallet.execute(operation);
        expect(receipt).toMatchObject({ replayed: true, revision: row.revision, commandKey: row.command_key, eventHash: row.event_hash });
        if (operation.type === "beginDispatch") {
          dispatches++;
          expect(row.result_json).toMatchObject({ shouldDispatch: true });
          expect(receipt.result).toEqual({ shouldDispatch: false, payout: before.state.payouts.get(operation.input) });
        } else {
          expect(walletJson(receipt.result)).toEqual(row.result_json);
          expect(walletDigest(receipt.result)).toBe(row.result_hash);
        }
        if (operation.version === 2 && operation.type === "acceptAmountCorrection") {
          const businessRetry = await wallet.execute({ ...operation, requestId: `v3-retry-old-acceptance-${row.revision}` });
          expect(businessRetry).toEqual(receipt);
          await expect(wallet.execute({ ...operation, requestId: `v3-forged-old-acceptance-${row.revision}`,
            actor: { kind: "buyer", id: "unrelated-history-buyer" } })).rejects.toThrow();
        }
      }
      expect(dispatches).toBe(3);
      const recovery = await wallet.recoverPayouts();
      expect(recovery.find(item => item.payout.id === WITHDRAWAL)).toEqual({
        payout: before.state.payouts.get(WITHDRAWAL), action: "lookup_original_reference",
      });
      expect(await wallet.execute(parseV3Command(command))).toEqual({ ...upgraded, replayed: true });
      const oldReservation = parseVersionedCommand(captured.commands[4]!.command_json);
      if (oldReservation.type !== "reserveTrade") throw new Error("Expected historical buyer reservation");
      await expect(wallet.execute(v2Command("reserveTrade", oldReservation.actor, oldReservation.requestId, oldReservation.input))).rejects.toThrow();
      await expect(wallet.execute(v2Command("pause", OWNER, "new-old-envelope-pause", null))).rejects.toThrow();
      await expect(createVersionedDurableWallet({ mode: "simulation-only", store }).snapshot()).rejects.toThrow();
      await expect(exportVersionedWalletBackup({ mode: "simulation-only", store, clock: () => AT + 2 })).rejects.toThrow();
      expect(await wallet.snapshot()).toEqual(before);
    } finally {
      try { await store?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }, 180_000);
});
