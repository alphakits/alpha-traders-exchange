// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectWalletBackup, restoreWalletBackup } from "./backup";
import { parseWalletCommand, walletDigest, walletJson } from "./commands";
import { createDurableWallet, initializeDurableWallet, verifyDurableHistory, walletCommand } from "./durable";
import { createFileWalletStore, type WalletStore } from "./durable-store";
import type { FileFakeProvider } from "./fake-provider";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createSimulationPayoutWorker } from "./payout-worker";

// These files were captured from the already-verified v1 engine, not generated
// by this test. A new version must keep this evidence readable and unchanged.
const backupText = readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.backup.json", import.meta.url), "utf8");
const stateText = readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.state.json", import.meta.url), "utf8");
const provenanceText = readFileSync(new URL("./fixtures/v1/provenance.json", import.meta.url), "utf8");
const capturedState: unknown = JSON.parse(stateText);
const provenance = JSON.parse(provenanceText) as Record<string, unknown>;
type CapturedRow = Record<string, unknown> & {
  revision: number; command_key: string; command_type: string; occurred_at_ms: string;
  command_json: unknown; result_json: unknown; result_hash: string; state_hash: string; event_hash: string;
};
const captured = JSON.parse(backupText) as { commands: CapturedRow[] };
const CHECKPOINT = {
  revision: 41,
  eventHash: "3ccf341413beead90cd64c72a81a5c5cf0538b191b99f589b3c2827db9771c7d",
  stateHash: "808ef429e451d1cdb2a71b25c0e8667ba54293bc9e6f3871d514bf804b1a8d1c",
  lastCommandAtMs: 1_793_793_641_000,
};
const BACKUP_CHECKSUM = "6d2f70f7380772432c5ce63bcd3c662f3d23c969ec2e30f4d47d0a1f6d2c4308";
const RESTORE_AT = 1_793_793_700_000;
const TRON = "tron-sim-usdt", BSC = "bsc-sim-binance-peg-usdt";
const WITHDRAWAL_ID = "withdrawal-v1-bsc-withdrawal";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("frozen historical wallet v1 compatibility", () => {
  it("pins the original capture and reads its v1 backup manifest without regenerating expectations", () => {
    expect(hash(backupText)).toBe("c4ee709415d1c129e9db31c1f90222cceffb4a2cfda2efc495cb6a974204e7ee");
    expect(hash(stateText)).toBe("cbbbb90b83b8846f01e1ef46643ae42962ba7961cd189dc7e45736c229a3aada");
    expect(hash(provenanceText)).toBe("0ffa77d72ef2e78da79645e22b588a8f573e787537bf775e8f92eec5af37b47a");
    expect(provenance).toMatchObject({
      sourceCommit: "f3422f9267562522da93285193d21dc604f8f40e",
      sourceTree: "488e5c2dd1b431ca516cabe8a86a7f92eea0f0a7",
      engineVersion: "alpha-wallet-simulation-v1", backupFormatVersion: 1,
      checkpoint: CHECKPOINT, backupChecksum: BACKUP_CHECKSUM,
    });
    expect(inspectWalletBackup(backupText, { expectedChecksum: BACKUP_CHECKSUM })).toEqual({
      format: "alpha-wallet-simulation-command-backup", formatVersion: 1, mode: "simulation-only",
      engineVersion: "alpha-wallet-simulation-v1", commandCount: 41, exportedAtMs: 1_793_793_642_000,
      checksum: BACKUP_CHECKSUM, checkpoint: CHECKPOINT,
    });
  });

  it("replays every captured v1 hash and preserves legacy state shape, exact units and fee rounding", () => {
    const recovered = verifyDurableHistory(captured.commands);
    expect(recovered).toMatchObject({ revision: CHECKPOINT.revision, eventHash: CHECKPOINT.eventHash, occurredAtMs: CHECKPOINT.lastCommandAtMs });
    expect(walletDigest(recovered.state)).toBe(CHECKPOINT.stateHash);
    // Full encoded state also freezes field absence, tagged bigint/map/set
    // encoding, insertion order and historical idempotency result shapes.
    expect(walletJson(recovered.state)).toEqual(capturedState);
    const state = recovered.state;
    expect(state.trades.get("v1-tron-trade-200")).toMatchObject({ status: "completed", amountRaw: BigInt("200000000"), totalFeeRaw: BigInt("4000000") });
    expect(state.trades.get("v1-tron-trade-300")).toMatchObject({ status: "reserved", amountRaw: BigInt("300000000"), fiatTotalMinor: BigInt("96960") });
    expect(balance(state, TRON, "trade:v1-tron-trade-300")).toBe(BigInt("300000000"));
    expect(balance(state, TRON, "platform-revenue")).toBe(BigInt("4000000"));
    expect(expectedCustody(state, TRON)).toBe(BigInt("304000000"));
    expect(state.trades.get("v1-bsc-trade")).toMatchObject({ status: "completed", amountRaw: BigInt("1000050000000000000"),
      buyerFeeRaw: BigInt("10001000000000000"), sellerFeeRaw: BigInt("10001000000000000"), fiatTotalMinor: BigInt("323") });
    expect(balance(state, BSC, "available:v1-seller")).toBe(BigInt("1"));
    expect(balance(state, BSC, "platform-revenue")).toBe(BigInt("20002000000000000"));
    expect(balance(state, BSC, `payout:${WITHDRAWAL_ID}`)).toBe(BigInt("9007199254740992123406789012345677"));
    expect(expectedCustody(state, BSC)).toBe(BigInt("9007199254740992143408789012345678"));
    expect(state.payouts.get(WITHDRAWAL_ID)).toMatchObject({ state: "submission_unknown", dispatchCount: 1,
      providerReference: "sim-payout-withdrawal-v1-bsc-withdrawal" });
    expect([...state.commissions.values()].every(commission => commission.paid)).toBe(true);
    expect(state.haltReason).toBeNull();
    assertLedgerInvariants(state);
  });

  it("restores and reopens the original rows before quarantine without reissuing historical dispatch authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-frozen-v1-"));
    const dataDir = join(directory, "restored");
    let store: WalletStore | undefined;
    try {
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      const restoration = await restoreWalletBackup({ mode: "simulation-only", store, backup: backupText,
        expectedChecksum: BACKUP_CHECKSUM, acknowledgeFreshTarget: true, clock: () => RESTORE_AT });
      expect(restoration.backup.checkpoint).toEqual(CHECKPOINT);
      expect(restoration).toMatchObject({ quarantined: true, restored: { revision: 42, lastCommandAtMs: RESTORE_AT } });
      await store.close();
      store = undefined;
      store = await createFileWalletStore({ mode: "simulation-only", dataDir });
      await initializeDurableWallet(store);
      const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => RESTORE_AT });
      const originalRows = await store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
        occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
        FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
      expect(originalRows.slice(0, CHECKPOINT.revision)).toEqual(captured.commands);
      expect(originalRows[CHECKPOINT.revision]).toMatchObject({ command_type: "pause", command_key: restoration.quarantineCommandKey,
        occurred_at_ms: String(RESTORE_AT), previous_event_hash: CHECKPOINT.eventHash });
      expect(originalRows).toHaveLength(42);
      const before = await wallet.snapshot();
      expect(before.state.haltReason).toBe("Operator emergency pause");
      expect(before.eventHash).toBe(restoration.restored.eventHash);
      expect(walletDigest(before.state)).toBe(restoration.restored.stateHash);
      expect(before.state.idempotency.size).toBe(42);
      expect(walletJson({ ...before.state, haltReason: null,
        idempotency: new Map([...before.state.idempotency].slice(0, CHECKPOINT.revision)) })).toEqual(capturedState);

      // Original business results remain original (for example a reservation's
      // response remains "reserved" even though that trade has since completed).
      // A captured shouldDispatch:true result is the explicit exception: replay
      // preserves its receipt identity but returns false with the current payout.
      let replayedDispatches = 0;
      for (const row of captured.commands) {
        const command = parseWalletCommand(row.command_json);
        if (!["reserveTrade", "confirmPayout", "requestWithdrawal", "beginDispatch"].includes(command.type)) continue;
        const replay = await wallet.execute(command);
        expect(replay).toMatchObject({ replayed: true, revision: row.revision, eventHash: row.event_hash, commandKey: row.command_key });
        if (command.type === "beginDispatch") {
          replayedDispatches++;
          expect(row.result_json).toMatchObject({ shouldDispatch: true });
          expect(replay.result).toEqual({ shouldDispatch: false, payout: before.state.payouts.get(command.input) });
        } else {
          expect(walletJson(replay.result)).toEqual(row.result_json);
          expect(walletDigest(replay.result)).toBe(row.result_hash);
        }
      }
      expect(replayedDispatches).toBe(3);
      expect((await wallet.recoverPayouts()).find(item => item.payout.id === WITHDRAWAL_ID)).toMatchObject({ action: "lookup_original_reference" });
      const provider = {
        kind: "alpha-wallet-file-fake-provider" as const,
        lookup: vi.fn(async () => ({ status: "not_found" as const })),
        submit: vi.fn(async () => { throw new Error("Frozen v1 recovery must never submit a replacement"); }),
        finalize: vi.fn(async () => { throw new Error("No fixture provider finalization is allowed here"); }),
      } satisfies FileFakeProvider;
      const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
      expect(await worker.step(WITHDRAWAL_ID)).toEqual({ payoutId: WITHDRAWAL_ID, status: "provider_lookup_required" });
      expect(provider.lookup).toHaveBeenCalledExactlyOnceWith(before.state.payouts.get(WITHDRAWAL_ID));
      expect(provider.submit).not.toHaveBeenCalled();
      expect(provider.finalize).not.toHaveBeenCalled();
      await expect(wallet.execute(walletCommand("beginDispatch", { kind: "dispatcher", id: "v1-dispatcher" }, "new-claim-after-v1-restore", WITHDRAWAL_ID)))
        .rejects.toThrow(/Wallet paused/);
      expect(await wallet.snapshot()).toEqual(before);
      assertLedgerInvariants(before.state);
    } finally {
      try { await store?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }, 120_000);
});
