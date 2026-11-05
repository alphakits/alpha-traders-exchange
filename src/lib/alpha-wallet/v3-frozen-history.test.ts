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
import { inspectV3WalletBackup, restoreV3WalletBackup } from "./v3-backup";
import { parseV3Command, parseV3VersionedCommand, v3CommandKey, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { createV3DurableWallet, verifyV3History } from "./v3-durable";
import { assertV3Invariants, isV3State } from "./v3-engine";

// Independent, one-time evidence from pinned original source, never rebuilt by
// this test or by a future engine version. The unpaused prefix is not a restore.
const historyText = readFileSync(new URL("./fixtures/v3/initial-acceptance.history.json", import.meta.url), "utf8");
const stateText = readFileSync(new URL("./fixtures/v3/initial-acceptance.state.json", import.meta.url), "utf8");
const backupText = readFileSync(new URL("./fixtures/v3/initial-acceptance.backup.json", import.meta.url), "utf8");
const provenanceText = readFileSync(new URL("./fixtures/v3/provenance.json", import.meta.url), "utf8");
type CapturedRow = Record<string, unknown> & {
  revision: number; command_key: string; command_type: string; occurred_at_ms: string;
  command_json: unknown; input_hash: string; result_json: unknown; result_hash: string;
  state_hash: string; previous_event_hash: string; event_hash: string;
};
const captured = JSON.parse(historyText) as { commands: CapturedRow[]; checkpoint: typeof CHECKPOINT; sourcePaused: boolean };
const backedUp = JSON.parse(backupText) as { commands: CapturedRow[] };
const capturedState: unknown = JSON.parse(stateText);
const provenance = JSON.parse(provenanceText) as {
  sourceCommit: string; sourceTree: string; captureScriptSha256: string; sourceSha256: Record<string, string>;
};
const CHECKPOINT = { revision: 14, eventHash: "846e734f1ea118575af2ec1b7199005f9c0c3d1c1188338dc80ff4f056370223",
  stateHash: "e9254bd9ba4e80879aab5641dead516a0076f8b5d951bbeab9ec7f35341bf2f5", lastCommandAtMs: 1_800_000_000_014 };
const PAUSED_CHECKPOINT = { revision: 15, eventHash: "8800c3431731ed3b88cc2fc071f98482bfdc05576120bbc9ffcc75e986355c7f",
  stateHash: "41360bb76d8139875f8aec1806238849e8d081c803cfe2eb18c105aa9759344f", lastCommandAtMs: 1_800_000_000_015 };
const BACKUP_CHECKSUM = "ac9086f4c23783336cebce1471c2cb8ea436f182562c58be721c4f4d1f74f944";
const RESTORE_AT = 1_800_000_100_000;
const TRON = "tron-sim-usdt", TRADE = "v3-fixture-trade", LISTING = "v3-fixture-listing";
const WITHDRAWAL = "withdrawal-v3-fixture-held-withdrawal";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const ORIGINAL_CONTRACTS = [
  "src/lib/alpha-wallet/amounts.ts", "src/lib/alpha-wallet/commands.ts", "src/lib/alpha-wallet/durable-store.ts",
  "src/lib/alpha-wallet/durable.ts", "src/lib/alpha-wallet/ledger.ts", "src/lib/alpha-wallet/sandbox.ts", "src/lib/alpha-wallet/types.ts",
  "src/lib/alpha-wallet/v2-commands.ts", "src/lib/alpha-wallet/v2-engine.ts", "src/lib/alpha-wallet/v2-kernel.ts",
  "src/lib/alpha-wallet/versioned-durable.ts", "src/lib/alpha-wallet/versioned-projections.ts",
  "src/lib/alpha-wallet/v3-commands.ts", "src/lib/alpha-wallet/v3-engine.ts", "src/lib/alpha-wallet/v3-durable.ts",
  "src/lib/alpha-wallet/v3-projections.ts", "src/lib/alpha-wallet/v3-backup.ts",
  "docs/alpha-wallet/durable-schema.sql", "docs/alpha-wallet/durable-v2-migration.sql", "docs/alpha-wallet/durable-v3-migration.sql",
] as const;
function checkpoint(snapshot: ReturnType<typeof verifyV3History>) {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
    lastCommandAtMs: snapshot.lastCommandAtMs };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("independently frozen v3 initial acceptance history", () => {
  it("pins original evidence and engine/storage/backup contracts without regenerating expectations", () => {
    expect(hash(historyText)).toBe("03df5221f9935d197817c2c0348ecafbd30512284ef65fb49b51182455be4db7");
    expect(hash(stateText)).toBe("442579ab1d75096074f59e4b57ccab56fde419e9bba1e34ddfeb6ee96bddaf1c");
    expect(hash(backupText)).toBe("de6421f28fe3ca1ad34ae00d95860da2724ad29ce712f55aa8ef7279fd404426");
    expect(hash(provenanceText)).toBe("21692c9e7b5215caac76e16966862cdb45ef493a3e82baae506e2ee5d4121237");
    expect(provenance.sourceCommit).toBe("2c3e6a0b809f9bb34f84dcc82243593ba079ee1f");
    expect(provenance.sourceTree).toBe("bcafe92cea246f709987643d6213b2347ed73e41");
    expect(Object.keys(provenance.sourceSha256)).toHaveLength(75);
    // captureScriptSha256 is the historical capture-time script, which may
    // receive nonsemantic maintenance later. The frozen provenance hash above
    // preserves that record; the original engine contracts stay pinned below.
    for (const path of ORIGINAL_CONTRACTS) {
      expect(hash(readFileSync(new URL(`../../../${path}`, import.meta.url))), path).toBe(provenance.sourceSha256[path]);
    }
  });

  it("verifies every original checkpoint and distinguishes the unpaused prefix from its paused backup", () => {
    for (const row of backedUp.commands) {
      expect(checkpoint(verifyV3History(backedUp.commands.slice(0, row.revision)))).toEqual({
        revision: row.revision, eventHash: row.event_hash, stateHash: row.state_hash, lastCommandAtMs: Number(row.occurred_at_ms),
      });
    }
    const original = verifyV3History(captured.commands);
    expect(captured.sourcePaused).toBe(false);
    expect(captured.checkpoint).toEqual(CHECKPOINT);
    expect(checkpoint(original)).toEqual(CHECKPOINT);
    expect(walletJson(original.state)).toEqual(capturedState);
    expect(original.engineVersion).toBe(WALLET_V3_ENGINE_VERSION);
    expect(original.state.haltReason).toBe(null);
    expect(backedUp.commands.slice(0, 14)).toEqual(captured.commands);
    expect(backedUp.commands[14]).toMatchObject({ command_type: "pause",
      command_key: '["operator","fixture-operator","pause","frozen-v3-source-pause"]' });
    expect(inspectV3WalletBackup(backupText, { expectedChecksum: BACKUP_CHECKSUM })).toMatchObject({
      formatVersion: 3, sourcePaused: true, commandCount: 15, initialAcceptanceCount: 1, checkpoint: PAUSED_CHECKPOINT,
    });
  });

  it("retains seller acceptance, buyer evidence, full principal and the original uncertain withdrawal", () => {
    const { state } = verifyV3History(captured.commands);
    expect(isV3State(state)).toBe(true);
    if (!isV3State(state)) throw new Error("Expected original v3 state");
    const acceptance = parseV3Command(captured.commands[13]!.command_json);
    if (acceptance.type !== "acceptInitialSellerRequest") throw new Error("Expected original seller acceptance");
    expect(acceptance.actor).toEqual({ kind: "seller", id: "fixture-seller" });
    expect(acceptance.input.buyerRequestEvidence.buyerId).toBe("fixture-buyer");
    expect(acceptance.input.terms.pricePerUsdt).toBe("3.10");
    expect(state.listings.get(LISTING)?.price).toBe("3.20");
    expect(state.initialBindings.size).toBe(1);
    expect(state.initialAcceptanceReceipts.size).toBe(1);
    expect(balance(state, TRON, `listing:${LISTING}`)).toBe(BigInt("300000000"));
    expect(balance(state, TRON, `trade:${TRADE}`)).toBe(BigInt("200000000"));
    expect(balance(state, TRON, "available:fixture-seller")).toBe(BigInt("75000000"));
    expect(expectedCustody(state, TRON)).toBe(BigInt("600000000"));
    expect(state.payouts.get(WITHDRAWAL)).toMatchObject({ state: "submission_unknown", dispatchCount: 1,
      amountRaw: BigInt("25000000"), providerReference: "sim-payout-withdrawal-v3-fixture-held-withdrawal" });
    assertV3Invariants(state); assertLedgerInvariants(state);
  });

  it("rejects a relabeled acceptance actor even after recomputing its command fingerprint", () => {
    const rows = structuredClone(captured.commands), row = rows[13]!;
    const original = parseV3Command(row.command_json);
    const forged = { ...original, actor: { kind: "buyer" as const, id: "fixture-buyer" } };
    row.command_json = forged; row.command_key = v3CommandKey(forged); row.input_hash = walletDigest(forged);
    expect(() => verifyV3History(rows)).toThrow();
    expect(hash(historyText)).toBe("03df5221f9935d197817c2c0348ecafbd30512284ef65fb49b51182455be4db7");
  });

  it.each(["result_hash", "state_hash", "event_hash", "previous_event_hash"] as const)("rejects changed original acceptance %s", field => {
    const rows = structuredClone(captured.commands);
    rows[13]![field] = "f".repeat(64);
    expect(() => verifyV3History(rows)).toThrow();
  });

  it("restores the captured backup, retains all original rows and replays without renewed dispatch authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-frozen-v3-history-"));
    const dataDir = join(directory, "wallet");
    let store: WalletStore | undefined;
    try {
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      const restored = await restoreV3WalletBackup({ mode: "simulation-only", store, backup: backupText,
        acknowledgeFreshTarget: true, expectedChecksum: BACKUP_CHECKSUM, clock: () => RESTORE_AT });
      expect(restored).toMatchObject({ quarantined: true, restored: { revision: 16 } });
      await store.close(); store = undefined;
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      const wallet = createV3DurableWallet({ mode: "simulation-only", store, clock: () => RESTORE_AT + 1 });
      const before = await wallet.snapshot();
      expect(checkpoint(before)).toEqual(restored.restored);
      expect(before.state.haltReason).toBeTruthy();
      const rows = await store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
        occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
        FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
      expect(rows.slice(0, 15)).toEqual(backedUp.commands);
      expect(rows[15]).toMatchObject({ command_type: "pause", command_key: restored.quarantineCommandKey });
      for (const row of captured.commands) {
        const operation = parseV3VersionedCommand(row.command_json), receipt = await wallet.execute(operation);
        expect(receipt).toMatchObject({ replayed: true, revision: row.revision, commandKey: row.command_key, eventHash: row.event_hash });
        if (operation.type === "beginDispatch") {
          expect(row.result_json).toMatchObject({ shouldDispatch: true });
          expect(receipt.result).toEqual({ shouldDispatch: false, payout: before.state.payouts.get(operation.input) });
        } else expect(walletJson(receipt.result)).toEqual(row.result_json);
      }
      const acceptance = parseV3Command(captured.commands[13]!.command_json);
      expect(await wallet.execute({ ...acceptance, requestId: "frozen-v3-new-transport-request" })).toMatchObject({
        replayed: true, revision: 14, eventHash: CHECKPOINT.eventHash,
      });
      expect(await wallet.recoverPayouts()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "lookup_original_reference" })]));
      expect(await wallet.snapshot()).toEqual(before);
    } finally {
      try { await store?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }, 120_000);
});
