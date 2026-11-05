// @vitest-environment node
// Two actual source transactions supply immutable inputs. Mutations below are
// pure file attacks; none opens, writes or repairs a restore target.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { marketplaceBackupFixture } from "../../../scripts/alpha-wallet/marketplace-backup-fixtures";
import { MAX_WALLET_BACKUP_BYTES, WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { createFileWalletStore } from "./durable-store";
import { exportMarketplaceWalletBackup } from "./marketplace-backup";
import {
  inspectMarketplaceWalletBackup, parseMarketplaceWalletBackup,
  type MarketplaceWalletBackupEnvelope,
} from "./marketplace-backup-manifest";
import { verifyVersionedHistory } from "./versioned-durable";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const;
let accepted: string, pending: string;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  for (const acceptCorrection of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-manifest-"));
    const store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    try {
      const source = await marketplaceBackupFixture(store, { acceptCorrection });
      const serialized = await exportMarketplaceWalletBackup({ mode: MODE, store, ...source.ownerInput, clock: source.clock });
      if (acceptCorrection) accepted = serialized;
      else pending = serialized;
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 120_000);
afterAll(() => { vi.unstubAllEnvs(); });

const object = (value: unknown) => value as Record<string, unknown>;
const currentRequest = (envelope: MarketplaceWalletBackupEnvelope) => envelope.canonical.purchase_requests.find(row => row.id === envelope.requestId)!;
const sibling = (envelope: MarketplaceWalletBackupEnvelope) => envelope.canonical.purchase_requests.find(row => row.id !== envelope.requestId)!;
function rehash(envelope: MarketplaceWalletBackupEnvelope) {
  const { checksum: _checksum, ...body } = envelope;
  void _checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}
function rehashWallet(envelope: MarketplaceWalletBackupEnvelope) {
  const { checksum: _checksum, ...body } = envelope.wallet;
  void _checksum;
  envelope.wallet.checksum = walletDigest(body);
}
function changed(mutate: (envelope: MarketplaceWalletBackupEnvelope) => void, source = accepted) {
  const envelope = JSON.parse(source) as MarketplaceWalletBackupEnvelope;
  mutate(envelope);
  return rehash(envelope);
}

describe("combined marketplace recovery manifest", () => {
  it("validates accepted and still-pending paused cohorts with exact financial allocations", () => {
    const a = parseMarketplaceWalletBackup(accepted), p = parseMarketplaceWalletBackup(pending);
    expect(a.coordination.acceptances).toHaveLength(1);
    expect(a.coordination.publications).toHaveLength(1);
    expect(a.coordination.acceptances[0].receipt.terms.principalRaw).toBe("300000000");
    expect(p.coordination.acceptances).toHaveLength(0);
    expect(p.coordination.publications).toHaveLength(0);
    expect(p.coordination.enrollments[0].binding.terms.principalRaw).toBe("200000000");
    expect(inspectMarketplaceWalletBackup(accepted)).toMatchObject({ formatVersion: 1, mode: MODE,
      halted: true, credentialsIncluded: false, commandCount: a.wallet.commands.length,
      checkpoint: a.wallet.checkpoint, walletChecksum: a.wallet.checksum,
      coordinationRowCounts: { enrollments: 1, acceptances: 1, publications: 1 } });
  });

  it("retains physical microseconds and large runtime versions without JSON number coercion", () => {
    const value = changed(envelope => {
      envelope.canonical.runtime_meta[0].updated_at = "2026-11-05T10:20:30.123456Z";
      envelope.canonical.runtime_meta[0].version = "9223372036854775807";
    });
    expect(parseMarketplaceWalletBackup(value).canonical.runtime_meta[0]).toMatchObject({
      updated_at: "2026-11-05T10:20:30.123456Z", version: "9223372036854775807",
    });
  });

  it("returns safe detached metadata without financial instructions, user profiles or credentials", () => {
    const document = parseMarketplaceWalletBackup(accepted);
    const metadata = inspectMarketplaceWalletBackup(accepted, { expectedChecksum: document.checksum });
    const text = JSON.stringify(metadata);
    for (const forbidden of ["passwordHash", "token_hash", "sessionToken", "sellerBankAccountSnapshot", "accountNumber",
      "0000000000", "Synthetic fixture bank", "destination", "sim://", "fixture-owner@example.invalid", "payload"]) expect(text).not.toContain(forbidden);
    for (const row of document.canonical.users) expect(Object.keys(row).sort()).toEqual(["id", "role", "seller_status"]);
    expect(Object.hasOwn(document.canonical, "sessions")).toBe(false);
    expect(Object.hasOwn(document.coordination, "transaction_contexts")).toBe(false);
    metadata.checkpoint.revision = 0;
    expect(inspectMarketplaceWalletBackup(accepted).checkpoint.revision).toBeGreaterThan(0);
  });

  it("checks the independently retained canonical checksum and rejects file substitution", () => {
    const original = inspectMarketplaceWalletBackup(accepted);
    expect(() => parseMarketplaceWalletBackup(accepted, "0".repeat(64))).toThrow(/expected checksum/);
    expect(() => parseMarketplaceWalletBackup(accepted, "invalid")).toThrow(WalletBackupError);
    expect(() => parseMarketplaceWalletBackup(pending, original.checksum)).toThrow(/expected checksum/);
    expect(() => parseMarketplaceWalletBackup(accepted, original.checksum)).not.toThrow();
  });

  it("does not equate the raw file-byte checksum with its canonical document checksum", () => {
    const document = parseMarketplaceWalletBackup(accepted);
    const spaced = `\n\n${JSON.stringify(document)}\n`;
    expect(parseMarketplaceWalletBackup(spaced, document.checksum).checksum).toBe(document.checksum);
  });

  it.each([
    ["wrong envelope version", envelope => { object(envelope).formatVersion = 2; }],
    ["production mode", envelope => { object(envelope).mode = "production"; }],
    ["unreviewed canonical schema", envelope => { object(envelope).schemaVersion = "unknown"; }],
    ["extra root fields", envelope => { object(envelope).sql = "DROP TABLE alpha_exchange.users"; }],
    ["session rows", envelope => { object(envelope.canonical).sessions = []; }],
    ["transaction context rows", envelope => { object(envelope.coordination).transaction_contexts = []; }],
    ["password profile fields", envelope => { object(envelope.canonical.users[0]).passwordHash = "private-password-hash"; }],
    ["embedded authentication fields", envelope => { currentRequest(envelope).payload.sessionToken = "private-session-token"; }],
    ["nested authentication fields", envelope => { currentRequest(envelope).payload.unexpected = { password_hash: "private-password-hash" }; }],
    ["SQL from row fields", envelope => { object(envelope.canonical.listings[0]).sql = "malicious sql text"; }],
    ["duplicate request identity", envelope => { envelope.canonical.purchase_requests.push(structuredClone(envelope.canonical.purchase_requests[0])); }],
    ["duplicate user identity", envelope => { envelope.canonical.users.push(structuredClone(envelope.canonical.users[0])); }],
    ["nondeterministic row order", envelope => { envelope.canonical.users.reverse(); }],
    ["number-coerced runtime version", envelope => { object(envelope.canonical.runtime_meta[0]).version = 7; }],
    ["overflowed runtime version", envelope => { envelope.canonical.runtime_meta[0].version = "9223372036854775808"; }],
    ["truncated physical timestamp", envelope => { envelope.canonical.runtime_meta[0].updated_at = "2026-11-05T10:20:30.123Z"; }],
    ["impossible calendar timestamp", envelope => { envelope.canonical.runtime_meta[0].updated_at = "2026-02-31T10:20:30.123456Z"; }],
    ["submillisecond request disagreement", envelope => { currentRequest(envelope).updated_at = currentRequest(envelope).updated_at.replace(/000Z$/, "001Z"); }],
    ["missing enrolled buyer", envelope => { envelope.canonical.users = envelope.canonical.users.filter(row => row.id !== envelope.coordination.enrollments[0].buyer_id); }],
    ["owner identity demotion", envelope => { envelope.canonical.users.find(row => row.id === envelope.ownerId)!.role = "buyer"; }],
    ["noncanonical target alias", envelope => { envelope.requestId = envelope.coordination.enrollments[0].platform_trade_id!; }],
    ["missing coordination receipt", envelope => { envelope.coordination.acceptances = []; }],
    ["missing publication", envelope => { envelope.coordination.publications = []; }],
    ["changed immutable enrollment fingerprint", envelope => { envelope.coordination.enrollments[0].input_digest = "0".repeat(64); }],
    ["changed immutable acceptance fingerprint", envelope => { envelope.coordination.acceptances[0].input_digest = "0".repeat(64); }],
    ["changed enrollment command link", envelope => { envelope.coordination.enrollments[0].wallet_command_revision--; }],
    ["changed acceptance event hash", envelope => { envelope.coordination.acceptances[0].wallet_event_hash = "0".repeat(64); }],
    ["changed public intent terms digest", envelope => { envelope.coordination.publications[0].payload.termsDigest = "0".repeat(64); }],
    ["extra private intent fields", envelope => { object(envelope.coordination.publications[0].payload).bank = "private-bank-value"; }],
    ["changed normalized seller", envelope => { currentRequest(envelope).seller_id = envelope.ownerId; }],
    ["changed current amount", envelope => { currentRequest(envelope).payload.usdtAmount = "301"; }],
    ["changed frozen payment instructions", envelope => { object(currentRequest(envelope).payload.sellerBankAccountSnapshot).accountNumber = "private-changed-account"; }],
    ["changed original request notes", envelope => { currentRequest(envelope).payload.buyerNotes = "changed after acceptance"; }],
    ["changed protected sibling inventory", envelope => { sibling(envelope).payload.buyerNotes = "changed sibling after acceptance"; }],
    ["changed accepted proposal", envelope => { object(currentRequest(envelope).payload.termsProposal).usdtAmount = "301"; }],
    ["changed listing budget", envelope => { envelope.canonical.listings[0].payload.availableAmount = "501"; }],
    ["changed locked listing information", envelope => { envelope.canonical.listings[0].payload.sellerDescription = "changed after acceptance"; }],
    ["changed derived projection", envelope => { envelope.canonical.trades.find(row => row.purchase_request_id === envelope.requestId)!.payload.status = "completed"; }],
    ["missing system message", envelope => { currentRequest(envelope).payload.messages = []; }],
    ["changed system message", envelope => { object((currentRequest(envelope).payload.messages as unknown[])[0]).message = "changed acceptance message"; }],
    ["changed notification read flag", envelope => { envelope.canonical.notifications[0].is_read = true; envelope.canonical.notifications[0].payload.isRead = true; }],
    ["missing seller notification", envelope => { envelope.canonical.notifications = []; }],
    ["changed audit explanation", envelope => { envelope.canonical.audit_logs[0].payload.reason = "other_reason"; }],
    ["missing acceptance audit", envelope => { envelope.canonical.audit_logs = []; }],
    ["orphaned audit actor", envelope => { envelope.canonical.audit_logs[0].actor_user_id = "missing-actor"; envelope.canonical.audit_logs[0].payload.actorUserId = "missing-actor"; }],
    ["changed nested wallet checkpoint", envelope => { envelope.wallet.checkpoint.stateHash = "0".repeat(64); rehashWallet(envelope); }],
    ["changed nested wallet command", envelope => { object(envelope.wallet.commands[0].command_json).requestId = "different-operation"; rehashWallet(envelope); }],
    ["truncated nested wallet history", envelope => { envelope.wallet.commands.pop(); rehashWallet(envelope); }],
    ["outer clock before nested snapshot", envelope => { envelope.exportedAtMs = envelope.wallet.exportedAtMs - 1; }],
  ] satisfies [string, (envelope: MarketplaceWalletBackupEnvelope) => void][])("rejects recomputed %s before a target can be used", (_label, mutate) => {
    expect(() => parseMarketplaceWalletBackup(changed(mutate))).toThrow(WalletBackupError);
  });

  it("rejects an internally valid but unpaused wallet prefix", () => {
    const value = changed(envelope => {
      envelope.wallet.commands.pop();
      const snapshot = verifyVersionedHistory(envelope.wallet.commands);
      envelope.wallet.checkpoint = { revision: snapshot.revision, eventHash: snapshot.eventHash,
        stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
      rehashWallet(envelope);
    });
    expect(() => parseMarketplaceWalletBackup(value)).toThrow(/paused v2 wallet/);
  });

  it("rejects a second canonical reservation even when normalized identities agree", () => {
    const value = changed(envelope => {
      const other = sibling(envelope);
      other.status = "accepted"; other.payload.status = "accepted";
      const projection = envelope.canonical.trades.find(row => row.purchase_request_id === other.id)!;
      projection.status = "accepted"; projection.payload.status = "accepted";
    });
    expect(() => parseMarketplaceWalletBackup(value)).toThrow(/another active listing reservation/);
  });

  it("rejects newly introduced payment evidence in an otherwise unchanged cohort", () => {
    const value = changed(envelope => {
      envelope.canonical.evidence.push({ id: "evidence-after-backup", purchase_request_id: envelope.requestId,
        payload: { id: "evidence-after-backup", purchaseRequestId: envelope.requestId, side: "buyer" } });
    });
    expect(() => parseMarketplaceWalletBackup(value)).toThrow(/payment, dispute or commission progress/);
  });

  it("rejects duplicate deterministic message identities across different requests", () => {
    const value = changed(envelope => {
      const copied = structuredClone((currentRequest(envelope).payload.messages as Record<string, unknown>[])[0]);
      copied.purchaseRequestId = sibling(envelope).id;
      sibling(envelope).payload.messages = [copied];
    });
    expect(() => parseMarketplaceWalletBackup(value)).toThrow(/message identity is duplicated/);
  });

  it("rejects an accepted flag without a receipt in the paused pending cohort", () => {
    const value = changed(envelope => { object(currentRequest(envelope).payload.termsProposal).status = "accepted"; }, pending);
    expect(() => parseMarketplaceWalletBackup(value)).toThrow(/pending proposal/);
  });

  it("rejects malformed, oversized and deeply nested JSON with fixed private-data-free errors", () => {
    for (const input of ["", "{private-bank-value", accepted.slice(0, -1), "x".repeat(MAX_WALLET_BACKUP_BYTES + 1)]) {
      expect(() => parseMarketplaceWalletBackup(input)).toThrow(WalletBackupError);
    }
    let deep: unknown = "private-deep-value";
    for (let index = 0; index < 66; index++) deep = { nested: deep };
    expect(() => parseMarketplaceWalletBackup(JSON.stringify(deep))).toThrow(/nesting or item limit/);
    const value = changed(envelope => { object(envelope.coordination.publications[0].payload).privateData = "private-bank-value"; });
    try { parseMarketplaceWalletBackup(value); throw new Error("Expected a rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(WalletBackupError);
      expect(String(error)).not.toContain("private-bank-value");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("rejects row overflows and reserved prototype keys without truncating them", () => {
    const tooMany = changed(envelope => {
      const user = envelope.canonical.users[0];
      envelope.canonical.users = Array.from({ length: 1001 }, (_, index) => ({ ...user, id: `u${index.toString().padStart(4, "0")}` }));
    });
    expect(() => parseMarketplaceWalletBackup(tooMany)).toThrow(WalletBackupError);
    const prototype = accepted.replace('"buyerNotes": "original fixture note"', '"buyerNotes": "original fixture note", "__proto__": {"polluted": true}');
    expect(prototype).not.toBe(accepted);
    expect(() => parseMarketplaceWalletBackup(prototype)).toThrow(/object key/);
    expect(object({}).polluted).toBeUndefined();
  });
});
