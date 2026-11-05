// @vitest-environment node
// Real isolated source transactions produce the immutable fixtures. File attacks
// below are pure parsing/replay: no restore destination is opened or modified.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildInitialMarketplaceFixture } from "../../../scripts/alpha-wallet/initial-marketplace-fixtures";
import { MAX_WALLET_BACKUP_BYTES, WALLET_BACKUP_FORMAT, WalletBackupError } from "./backup";
import { walletDigest } from "./commands";
import { createFileWalletStore, type WalletStore } from "./durable-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "./initial-marketplace-coordinator";
import {
  INITIAL_MARKETPLACE_WALLET_BACKUP_FORMAT, INITIAL_MARKETPLACE_WALLET_BACKUP_SCHEMA, INITIAL_MARKETPLACE_WALLET_LEDGER_SCOPE,
  initialMarketplaceCanonicalRowsSchema, initialMarketplaceCoordinationRowsSchema,
  inspectInitialMarketplaceWalletBackup, parseInitialMarketplaceWalletBackup, type InitialMarketplaceWalletBackupEnvelope,
} from "./initial-marketplace-backup-manifest";
import { inspectMarketplaceWalletBackup } from "./marketplace-backup-manifest";
import { inspectV3WalletBackup } from "./v3-backup";
import { WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { verifyV3History } from "./v3-durable";
import { isV3State } from "./v3-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const;
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
let accepted: string, pending: string, priorTrade: string, faceToFace: string;
let postgresBasisTimes: { source: string; result: string }[];
const object = (value: unknown) => value as Record<string, unknown>;
const current = (envelope: InitialMarketplaceWalletBackupEnvelope) => envelope.canonical.purchase_requests.find(row => row.id === envelope.requestId)!;
const activation = (envelope: InitialMarketplaceWalletBackupEnvelope) => envelope.coordination.activations[0];
const other = (envelope: InitialMarketplaceWalletBackupEnvelope) => envelope.canonical.purchase_requests.find(row => row.id !== envelope.requestId
  && row.listing_id !== activation(envelope).platform_listing_id)!;
const sibling = (envelope: InitialMarketplaceWalletBackupEnvelope) => envelope.canonical.purchase_requests.find(row => row.id !== envelope.requestId
  && row.listing_id === activation(envelope).platform_listing_id)!;

function rehash(envelope: InitialMarketplaceWalletBackupEnvelope) {
  const { checksum: _checksum, ...body } = envelope; void _checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}
function rehashWallet(envelope: InitialMarketplaceWalletBackupEnvelope) {
  const { checksum: _checksum, ...body } = envelope.wallet; void _checksum;
  envelope.wallet.checksum = walletDigest(body);
}
function changed(mutate: (envelope: InitialMarketplaceWalletBackupEnvelope) => void, source = accepted) {
  const envelope = JSON.parse(source) as InitialMarketplaceWalletBackupEnvelope;
  mutate(envelope); return rehash(envelope);
}

/** Independent fixture capture, not the exporter/restore under test. */
async function captureFixture(store: WalletStore, requestId: string, ownerId: string, atMs: number) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV3History(commands);
    if (!isV3State(snapshot.state)) throw new Error("Synthetic initial source must have an actual v3 history");
    const walletBody = { format: WALLET_BACKUP_FORMAT, formatVersion: 3, scope: INITIAL_MARKETPLACE_WALLET_LEDGER_SCOPE,
      mode: MODE, engineVersion: WALLET_V3_ENGINE_VERSION, sourcePaused: true, exportedAtMs: atMs,
      checkpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs },
      continuation: snapshot.state.continuation, initialContinuation: snapshot.state.initialContinuation, commands };
    const canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) {
      const captured = (await tx.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t
        ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(item => item.row);
      canonical[table] = captured.map(row => {
        const retained = { ...row };
        if (table === "users") for (const key of ["email", "payload", "availability_status", "online_status"]) delete retained[key];
        for (const [key, value] of Object.entries(retained)) {
          if (key.endsWith("_at") && typeof value === "string") {
            const micros = /\.(\d{1,6})/.exec(value)?.[1].padEnd(6, "0").slice(3) ?? "000";
            retained[key] = new Date(value).toISOString().replace(/Z$/, `${micros}Z`);
          }
        }
        if (table === "runtime_meta") retained.version = String(retained.version);
        if (table === "evidence" && typeof retained.content === "string") {
          if (!/^\\x[0-9a-f]*$/.test(retained.content)) throw new Error("Unexpected synthetic bytea representation");
          retained.content = Buffer.from(retained.content.slice(2), "hex").toString("base64");
        }
        return retained;
      }).sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    }
    const coordination: Record<string, unknown> = {};
    for (const [table, key] of [["activations", "request_id"], ["acceptances", "acceptance_key"], ["publications", "id"]]) {
      coordination[table] = (await tx.query(`SELECT * FROM alpha_wallet_initial_marketplace_simulation.${table} ORDER BY ${key}`)).rows;
    }
    const body = { format: INITIAL_MARKETPLACE_WALLET_BACKUP_FORMAT, formatVersion: 1, mode: MODE,
      schemaVersion: INITIAL_MARKETPLACE_WALLET_BACKUP_SCHEMA, exportedAtMs: atMs, requestId, ownerId,
      wallet: { ...walletBody, checksum: walletDigest(walletBody) }, canonical, coordination };
    return JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
  });
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  for (const variant of ["accepted", "pending", "priorTrade", "faceToFace"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-manifest-"));
    const store = await createFileWalletStore({ mode: MODE, dataDir: directory });
    try {
      const fixture = await buildInitialMarketplaceFixture(store, {
        paymentMethod: variant === "faceToFace" ? "Face-to-Face" : "Bank Transfer",
        tradeProjection: ["priorTrade", "faceToFace"].includes(variant) ? "pending" : "absent",
        assetId: variant === "faceToFace" ? "bsc-sim-binance-peg-usdt" : "tron-sim-usdt",
      });
      const canonical = fixture.canonical;
      if (variant === "accepted") postgresBasisTimes = await store.transaction(async tx =>
        (await tx.query<{ source: string; result: string }>(`SELECT source,to_jsonb(source::timestamptz)#>>'{}' AS result
          FROM (VALUES ('2027-01-15T08:00:00.000000Z'),('2027-01-15T08:00:00.100000Z'),
            ('2027-01-15T08:00:00.000001Z'),('2027-01-15T08:00:00.123456Z'),('2027-01-15T08:00:00.010100Z')) AS times(source)`)).rows);
      // Retain a real non-target bytea row and enforcement record. This exercises
      // the richer initial schema that an older correction bundle would omit.
      await store.transaction(async tx => {
        const evidence = { id: "retained-historical-evidence", purchaseRequestId: canonical.buyerHistoryRequestId, side: "buyer",
          uploadedByUserId: canonical.buyerId, mimeType: "application/pdf", fileName: "synthetic.pdf", sizeBytes: 4,
          uploadedAt: canonical.at, storagePath: "simulation-only/history/synthetic.pdf", status: "stored" };
        await tx.query(`INSERT INTO alpha_exchange.evidence VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,55,$9::jsonb,decode('61626364','hex'))`,
        [evidence.id, evidence.purchaseRequestId, evidence.side, evidence.uploadedByUserId, evidence.mimeType,
          evidence.fileName, evidence.sizeBytes, evidence.uploadedAt, JSON.stringify(evidence)]);
        const enforcement = { id: "retained-other-enforcement", sellerId: canonical.otherSellerId, status: "revoked",
          violationNumber: 1, issuedAt: canonical.at, createdAt: canonical.at, updatedAt: canonical.at };
        await tx.query(`INSERT INTO alpha_exchange.marketplace_enforcement_records VALUES
          ($1,$2,$3,1,$4::timestamptz,NULL,$4::timestamptz,$4::timestamptz,56,$5::jsonb)`,
        [enforcement.id, enforcement.sellerId, enforcement.status, enforcement.createdAt, JSON.stringify(enforcement)]);
      });
      let now = canonical.acceptedAtMs;
      const coordinator = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => now });
      const owner = { sessionToken: canonical.ownerSessionToken, requestId: canonical.requestId };
      await coordinator.activateRequest({ ...owner, operationId: "manifest-activate", assetId: canonical.assetId,
        walletListingId: canonical.walletListingId, walletTradeId: canonical.walletTradeId });
      if (variant !== "pending") await coordinator.acceptRequest({ sessionToken: canonical.sellerSessionToken,
        requestId: canonical.requestId, operationId: "manifest-seller-accept",
        ...(variant === "faceToFace" ? { safetyAcknowledged: true as const } : {}) });
      now += 1000;
      await coordinator.pause({ ...owner, operationId: "manifest-owner-pause" });
      const serialized = await captureFixture(store, canonical.requestId, canonical.ownerId, now);
      if (variant === "accepted") accepted = serialized;
      else if (variant === "pending") pending = serialized;
      else if (variant === "priorTrade") priorTrade = serialized;
      else faceToFace = serialized;
    } finally {
      await store.close(); await rm(directory, { recursive: true, force: true });
    }
  }
}, 180_000);
afterAll(() => { vi.unstubAllEnvs(); });

describe("initial marketplace combined recovery manifest", () => {
  it("validates pending and accepted cohorts, both trade projection paths, both rails and face-to-face consent", () => {
    for (const value of [accepted, priorTrade, faceToFace]) {
      const raw = JSON.parse(value);
      for (const result of [initialMarketplaceCanonicalRowsSchema.safeParse(raw.canonical), initialMarketplaceCoordinationRowsSchema.safeParse(raw.coordination)]) {
        if (!result.success) throw new Error(JSON.stringify(result.error.issues.map(issue => ({ path: issue.path, code: issue.code }))));
      }
      const document = parseInitialMarketplaceWalletBackup(value);
      expect(document.coordination.acceptances).toHaveLength(1);
      expect(document.coordination.publications).toHaveLength(1);
      expect(document.coordination.acceptances[0].receipt.input.terms.usdtAmount).toBe("200");
      expect(document.coordination.acceptances[0].receipt.input.terms.pricePerUsdt).toBe("3.10");
      expect(current(document).payload.fiatAmount).toBe("626.20");
    }
    expect(parseInitialMarketplaceWalletBackup(pending).coordination.acceptances).toHaveLength(0);
    expect(parseInitialMarketplaceWalletBackup(priorTrade).canonical.trades[0].sort_index).toBe(31);
    expect(parseInitialMarketplaceWalletBackup(faceToFace).coordination.acceptances[0].receipt).toMatchObject({
      principalRaw: "200000000000000000000", input: { sellerAction: { faceToFaceSafetyAcknowledged: true } },
    });
  });

  it("preserves the original v1/v2/v3 history, activation JSON and all noncredential canonical columns", () => {
    const document = parseInitialMarketplaceWalletBackup(accepted);
    expect(new Set(document.wallet.commands.map(row => object(row.command_json).version))).toEqual(new Set([1, 2, 3]));
    expect(document.coordination.activations[0].canonical_basis).toEqual(JSON.parse(accepted).coordination.activations[0].canonical_basis);
    expect(document.canonical.evidence[0].content).toBe("YWJjZA==");
    expect(document.canonical.marketplace_enforcement_records).toHaveLength(1);
    expect(document.canonical.purchase_requests.every(row => typeof row.sort_index === "number" && row.created_at.endsWith("000Z"))).toBe(true);
    for (const user of document.canonical.users) expect(Object.keys(user).sort()).toEqual(["created_at", "id", "role", "seller_status", "sort_index", "updated_at"]);
    expect(Object.hasOwn(document.canonical, "sessions")).toBe(false);
    expect(Object.hasOwn(document.coordination, "transaction_contexts")).toBe(false);
  });

  it("keeps this complete recovery unit distinct from every older standalone/correction format", () => {
    const document = parseInitialMarketplaceWalletBackup(accepted);
    expect(() => inspectV3WalletBackup(JSON.stringify(document.wallet))).toThrow(WalletBackupError);
    expect(() => inspectMarketplaceWalletBackup(accepted)).toThrow(WalletBackupError);
    expect(() => parseInitialMarketplaceWalletBackup(changed(value => { object(value.wallet).scope = "isolated-v3-ledger"; rehashWallet(value); }))).toThrow(WalletBackupError);
    expect(() => parseInitialMarketplaceWalletBackup(changed(value => { object(value).format = "alpha-wallet-marketplace-simulation-backup"; }))).toThrow(WalletBackupError);
  });

  it("returns detached safe metadata and checks the independently retained checksum", () => {
    const document = parseInitialMarketplaceWalletBackup(accepted);
    const metadata = inspectInitialMarketplaceWalletBackup(accepted, { expectedChecksum: document.checksum });
    expect(metadata).toMatchObject({ formatVersion: 1, mode: MODE, halted: true, credentialsIncluded: false,
      checkpoint: document.wallet.checkpoint, commandCount: document.wallet.commands.length,
      coordinationRowCounts: { activations: 1, acceptances: 1, publications: 1 } });
    for (const forbidden of ["password", "session", "token", "payload", "sim://", "sellerBankAccountSnapshot", "accountNumber",
      "Synthetic fixture bank", "destination", "canonical_basis", "YWJjZA=="]) expect(JSON.stringify(metadata)).not.toContain(forbidden);
    metadata.checkpoint.revision = 0;
    expect(inspectInitialMarketplaceWalletBackup(accepted).checkpoint.revision).toBeGreaterThan(0);
    for (const checksum of ["bad", "0".repeat(64), inspectInitialMarketplaceWalletBackup(pending).checksum]) {
      expect(() => parseInitialMarketplaceWalletBackup(accepted, checksum)).toThrow(/expected checksum/);
    }
    expect(parseInitialMarketplaceWalletBackup(`\n${JSON.stringify(document)}\n`, document.checksum).checksum).toBe(document.checksum);
  });

  it("retains native microseconds and large versions, without coercing original history or granting historical roles authority", () => {
    const value = changed(document => {
      document.canonical.runtime_meta[0].version = "9223372036854775807";
      document.canonical.runtime_meta[0].updated_at = "2026-11-05T10:20:30.123456Z";
      const seller = document.canonical.users.find(row => row.id === activation(document).seller_id)!;
      seller.role = "buyer"; seller.seller_status = "suspended";
    });
    const parsed = parseInitialMarketplaceWalletBackup(value);
    expect(parsed.canonical.runtime_meta[0]).toMatchObject({ version: "9223372036854775807", updated_at: "2026-11-05T10:20:30.123456Z" });
    expect(object((parsed.coordination.acceptances[0].canonical_result.request.timeline as unknown[]).at(-1)).actorRole).toBe("approved_seller");
  });

  it("requires exact PostgreSQL UTC JSON timestamp spelling without rewriting retained provenance", () => {
    expect(postgresBasisTimes.map(row => row.result)).toEqual([
      "2027-01-15T08:00:00+00:00", "2027-01-15T08:00:00.1+00:00", "2027-01-15T08:00:00.000001+00:00",
      "2027-01-15T08:00:00.123456+00:00", "2027-01-15T08:00:00.0101+00:00",
    ]);
    for (const row of postgresBasisTimes) {
      const coordination = structuredClone(JSON.parse(accepted).coordination);
      coordination.activations[0].canonical_basis.request.created_at = row.result;
      const checked = initialMarketplaceCoordinationRowsSchema.parse(coordination);
      expect(checked.activations[0].canonical_basis.request.created_at).toBe(row.result);
    }
    for (const spelling of ["2027-01-15T08:00:00Z", "2027-01-15T08:00:00.000Z", "2027-01-15T08:00:00.000+00:00",
      "2027-01-15T08:00:00.000000+00:00", "2027-01-15T10:00:00+02:00", "2027-01-15T08:00:00-00:00"]) {
      expect(() => parseInitialMarketplaceWalletBackup(changed(document => {
        activation(document).canonical_basis.request.created_at = spelling;
      }))).toThrow(WalletBackupError);
    }
    for (const spelling of ["2027-01-15T08:00:00.10+00:00", "2027-01-15T08:00:00.010100+00:00"] ) {
      const coordination = structuredClone(JSON.parse(accepted).coordination);
      coordination.activations[0].canonical_basis.request.created_at = spelling;
      expect(initialMarketplaceCoordinationRowsSchema.safeParse(coordination).success).toBe(false);
    }
  });

  it.each([
    ["unsupported root version", e => { object(e).formatVersion = 2; }],
    ["production mode", e => { object(e).mode = "production"; }],
    ["unsupported schema", e => { object(e).schemaVersion = "other"; }],
    ["arbitrary executable root", e => { object(e).sql = "untrusted SQL"; }],
    ["missing enforcement table", e => { delete object(e.canonical).marketplace_enforcement_records; }],
    ["old correction trust table", e => { object(e.canonical).trust_snapshots = []; }],
    ["web session rows", e => { object(e.canonical).sessions = []; }],
    ["mobile credential rows", e => { object(e.canonical).mobile_device_sessions = []; }],
    ["old transaction registration", e => { object(e.coordination).transaction_contexts = []; }],
    ["user profile material", e => { object(e.canonical.users[0]).payload = { passwordHash: "private-secret" }; }],
    ["nested request credential", e => { current(e).payload.access_token = "private-secret"; }],
    ["nested activation credential", e => { activation(e).canonical_basis.request.payload.secret = { privateKey: "private-secret" }; }],
    ["nested canonical-result credential", e => { e.coordination.acceptances[0].canonical_result.request.secret = { token_hash: "private-secret" }; }],
    ["duplicate request", e => { e.canonical.purchase_requests.push(structuredClone(current(e))); }],
    ["duplicate user", e => { e.canonical.users.push(structuredClone(e.canonical.users[0])); }],
    ["nondeterministic table ordering", e => { e.canonical.users.reverse(); }],
    ["runtime bigint number", e => { object(e.canonical.runtime_meta[0]).version = 7; }],
    ["runtime bigint overflow", e => { e.canonical.runtime_meta[0].version = "9223372036854775808"; }],
    ["truncated microseconds", e => { e.canonical.runtime_meta[0].updated_at = "2026-11-05T10:20:30.123Z"; }],
    ["invalid calendar date", e => { e.canonical.runtime_meta[0].updated_at = "2026-02-31T10:20:30.123456Z"; }],
    ["submillisecond normalized disagreement", e => { current(e).updated_at = current(e).updated_at.replace(/000Z$/, "001Z"); }],
    ["normalized request ordering change", e => { current(e).sort_index++; }],
    ["normalized seller alias", e => { current(e).seller_id = e.ownerId; }],
    ["missing buyer identity", e => { e.canonical.users = e.canonical.users.filter(row => row.id !== activation(e).buyer_id); }],
    ["missing exporting owner reference", e => { e.ownerId = "absent-owner"; }],
    ["request id versus trade alias", e => { e.requestId = activation(e).platform_trade_id; }],
    ["activation fingerprint", e => { activation(e).input_digest = "0".repeat(64); }],
    ["activation mapping", e => { activation(e).wallet_trade_id = "other-wallet-trade"; }],
    ["activation checkpoint link", e => { activation(e).wallet_checkpoint.revision--; }],
    ["activation basis source amount", e => { activation(e).canonical_basis.request.payload.usdtAmount = "201"; }],
    ["activation basis source request notes", e => { activation(e).canonical_basis.request.payload.buyerNotes = "changed immutable request"; }],
    ["activation basis listing sort", e => { activation(e).canonical_basis.listing.sort_index++; }],
    ["activation missing sibling", e => { activation(e).canonical_basis.siblings.pop(); }],
    ["canonical sibling notes", e => { sibling(e).payload.buyerNotes = "changed protected sibling"; }],
    ["canonical sibling sort", e => { sibling(e).sort_index++; }],
    ["canonical request current amount", e => { current(e).payload.usdtAmount = "201"; }],
    ["canonical frozen bank instructions", e => { object(current(e).payload.sellerBankAccountSnapshot).accountNumber = "private-modified-bank"; }],
    ["current listing budget", e => { e.canonical.listings.find(row => row.id === activation(e).platform_listing_id)!.payload.availableAmount = "501"; }],
    ["missing receipt", e => { e.coordination.acceptances = []; }],
    ["missing publication", e => { e.coordination.publications = []; }],
    ["receipt seller actor", e => { e.coordination.acceptances[0].actor_user_id = activation(e).buyer_id; }],
    ["receipt public consent fingerprint", e => { e.coordination.acceptances[0].input_digest = "0".repeat(64); }],
    ["receipt command link", e => { e.coordination.acceptances[0].wallet_command_revision--; }],
    ["receipt event hash", e => { e.coordination.acceptances[0].wallet_event_hash = "0".repeat(64); }],
    ["receipt original financial terms", e => { e.coordination.acceptances[0].receipt.input.terms.fiatAmount = "1.00"; }],
    ["receipt result lifecycle", e => { e.coordination.acceptances[0].canonical_result.request.status = "completed"; }],
    ["missing physical accepted trade", e => { e.canonical.trades = []; }],
    ["physical accepted trade sort", e => { e.canonical.trades[0].sort_index++; }],
    ["missing canonical acceptance timeline", e => { current(e).payload.timeline = [object(current(e).payload.timeline)["0"]]; }],
    ["missing canonical notification", e => { e.canonical.notifications = []; }],
    ["notification read mutation", e => { e.canonical.notifications[0].is_read = true; e.canonical.notifications[0].payload.isRead = true; }],
    ["notification sort mutation", e => { e.canonical.notifications[0].sort_index++; }],
    ["missing canonical audit", e => { e.canonical.audit_logs = []; }],
    ["canonical audit explanation", e => { e.canonical.audit_logs[0].payload.details = "changed private explanation"; }],
    ["publication amount link", e => { e.coordination.publications[0].payload.termsDigest = "0".repeat(64); }],
    ["extra private publication", e => { object(e.coordination.publications[0].payload).destination = "private-value"; }],
    ["binary evidence truncation", e => { e.canonical.evidence[0].content = "YWJj"; }],
    ["noncanonical binary encoding", e => { e.canonical.evidence[0].content = "YWJjZA==\n"; }],
    ["evidence normalized metadata", e => { e.canonical.evidence[0].file_name = "other.pdf"; }],
    ["enforcement normalized metadata", e => { e.canonical.marketplace_enforcement_records[0].violation_number++; }],
    ["nested wallet checkpoint", e => { e.wallet.checkpoint.stateHash = "0".repeat(64); rehashWallet(e); }],
    ["nested wallet continuation", e => { e.wallet.initialContinuation.commandRevision--; rehashWallet(e); }],
    ["nested wallet command", e => { object(e.wallet.commands[0].command_json).requestId = "changed-command"; rehashWallet(e); }],
    ["nested history truncation", e => { e.wallet.commands.pop(); rehashWallet(e); }],
    ["nested paused flag", e => { object(e.wallet).sourcePaused = false; rehashWallet(e); }],
    ["nested wallet old schema version", e => { object(e.wallet).formatVersion = 2; rehashWallet(e); }],
    ["outer clock before wallet export", e => { e.exportedAtMs = e.wallet.exportedAtMs - 1; }],
  ] satisfies [string, (envelope: InitialMarketplaceWalletBackupEnvelope) => void][])("rejects recomputed %s before any target is opened", (_label, mutate) => {
    expect(() => parseInitialMarketplaceWalletBackup(changed(mutate))).toThrow(WalletBackupError);
  });

  it("rejects an internally verified unpaused prefix, even with matching recalculated checkpoints", () => {
    const value = changed(document => {
      document.wallet.commands.pop();
      const snapshot = verifyV3History(document.wallet.commands);
      document.wallet.checkpoint = { revision: snapshot.revision, eventHash: snapshot.eventHash,
        stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
      rehashWallet(document);
    });
    expect(() => parseInitialMarketplaceWalletBackup(value)).toThrow(/paused v3 source/);
  });

  it("rejects an accepted flag or new trade in the unaccepted paused cohort", () => {
    const value = changed(document => { current(document).status = "accepted"; current(document).payload.status = "accepted"; }, pending);
    expect(() => parseInitialMarketplaceWalletBackup(value)).toThrow(/original canonical basis/);
  });

  it("rejects duplicate deterministic acceptance events elsewhere in canonical history", () => {
    const value = changed(document => {
      other(document).payload.timeline = [...payloadTimeline(other(document).payload),
        structuredClone(payloadTimeline(current(document).payload).at(-1))];
    });
    expect(() => parseInitialMarketplaceWalletBackup(value)).toThrow(/event identity is duplicated/);
  });

  it("rejects new target payment evidence while retaining unrelated historical binary evidence", () => {
    const value = changed(document => {
      const row = document.canonical.evidence[0];
      row.purchase_request_id = document.requestId; row.payload.purchaseRequestId = document.requestId;
    });
    expect(() => parseInitialMarketplaceWalletBackup(value)).toThrow(/unsupported payment/);
  });

  it("rejects malformed, deeply nested and oversized content without disclosing private payloads", () => {
    for (const text of ["", "{private-bank-value", accepted.slice(0, -1), "x".repeat(MAX_WALLET_BACKUP_BYTES + 1)]) {
      expect(() => parseInitialMarketplaceWalletBackup(text)).toThrow(WalletBackupError);
    }
    let deep: unknown = "private-deep-value";
    for (let i = 0; i < 66; i++) deep = { nested: deep };
    expect(() => parseInitialMarketplaceWalletBackup(JSON.stringify(deep))).toThrow(/nesting or item limit/);
    const attack = changed(document => { object(document.coordination.publications[0].payload).secretData = "private-bank-value"; });
    try { parseInitialMarketplaceWalletBackup(attack); throw new Error("Expected validation rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(WalletBackupError);
      expect(String(error)).not.toContain("private-bank-value"); expect(error).not.toHaveProperty("cause");
    }
  });

  it("rejects overflowing rows and prototype keys without truncation", () => {
    const tooMany = changed(document => {
      document.canonical.users = Array.from({ length: 1001 }, (_, index) => ({ ...document.canonical.users[0], id: `user-${index.toString().padStart(4, "0")}` }));
    });
    expect(() => parseInitialMarketplaceWalletBackup(tooMany)).toThrow(WalletBackupError);
    const poisoned = accepted.replace('"buyerNotes": "Retained buyer request"', '"buyerNotes": "Retained buyer request", "__proto__": {"polluted": true}');
    expect(poisoned).not.toBe(accepted);
    expect(() => parseInitialMarketplaceWalletBackup(poisoned)).toThrow(/object key/);
    expect(object({}).polluted).toBeUndefined();
  });
});

function payloadTimeline(payload: Record<string, unknown>) { return payload.timeline as Record<string, unknown>[]; }
