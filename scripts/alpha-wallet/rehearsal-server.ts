/** Local synthetic rehearsal only; deliberately separate from production routes and authentication. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { assetFor, formatUnits, parseUnits, SANDBOX_ASSETS, type AssetId } from "../../src/lib/alpha-wallet/amounts";
import { walletDigest, type CommandOf, type WalletCommandType } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createFileFakeProvider, type FileFakeProvider } from "../../src/lib/alpha-wallet/fake-provider";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { createSimulationPayoutWorker } from "../../src/lib/alpha-wallet/payout-worker";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { Actor } from "../../src/lib/alpha-wallet/types";
import { rehearsalPage } from "./rehearsal-page";

const ROLES = ["seller", "buyer", "owner", "verifier", "worker"] as const;
type Role = typeof ROLES[number];
const ACTORS: Record<Role, Actor> = {
  seller: { kind: "seller", id: "rehearsal-seller" }, buyer: { kind: "buyer", id: "rehearsal-buyer" },
  owner: { kind: "operator", id: "rehearsal-owner" }, verifier: { kind: "verifier", id: "rehearsal-verifier" },
  worker: { kind: "dispatcher", id: "rehearsal-worker" },
};
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,60}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const amount = z.string().regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/);
const assetId = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const envelope = <T extends string, S extends z.ZodRawShape>(action: T, fields: S) => z.strictObject({ action: z.literal(action), requestId, ...fields });
const actionSchema = z.discriminatedUnion("action", [
  envelope("listing-create", { assetId, amount, price: amount }),
  envelope("funding-create", { assetId, purpose: z.enum(["principal", "commission"]) }),
  envelope("funding-observe", { intentId: id, amount, finalized: z.boolean() }),
  envelope("listing-approve", { listingId: id }), envelope("listing-close", { listingId: id }),
  envelope("trade-reserve", { listingId: id, amount }), envelope("payment-claim", { tradeId: id }),
  envelope("payment-verify", { tradeId: id }), envelope("release-authorize", { tradeId: id }),
  envelope("trade-cancel", { tradeId: id }), envelope("trade-dispute", { tradeId: id }),
  envelope("custody-reconcile", { assetId }), envelope("gas-ready", { assetId, ready: z.boolean() }),
  envelope("payout-queue", { tradeId: id }), envelope("payout-step", { payoutId: id, loseResponse: z.boolean() }),
  envelope("payout-claim-only", { payoutId: id }), envelope("payout-finalize", { payoutId: id, successful: z.boolean() }),
  envelope("withdrawal-create", { assetId, amount }), envelope("wallet-pause", {}),
]);
type Action = z.infer<typeof actionSchema>;
const ACTION_ROLES: Record<Action["action"], readonly Role[]> = {
  "listing-create": ["seller"], "funding-create": ["seller"], "funding-observe": ["verifier"],
  "listing-approve": ["owner"], "listing-close": ["seller"], "trade-reserve": ["buyer"],
  "payment-claim": ["buyer"], "payment-verify": ["verifier"], "release-authorize": ["seller"],
  "trade-cancel": ["buyer", "seller"], "trade-dispute": ["buyer", "seller", "owner"],
  "custody-reconcile": ["verifier"], "gas-ready": ["owner"], "payout-queue": ["worker"],
  "payout-step": ["worker"], "payout-claim-only": ["worker"], "payout-finalize": ["verifier"],
  "withdrawal-create": ["seller"], "wallet-pause": ["owner"],
};
const COOKIE = "alpha_wallet_rehearsal";
const MAX_BODY = 4096;
const SESSION_MS = 60 * 60 * 1000;
const CONTAINER_MARKER = "alpha-wallet-rehearsal.json";
const MARKER_CONTENT = '{"kind":"alpha-wallet-local-rehearsal","version":1}\n';
const CONTAINER_ID = "alpha-wallet-rehearsal-id";
type Session = { role: Role; csrf: string; expires: number };
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function rehearsalDirectory(requested?: string) {
  const directory = requested ?? await mkdtemp(join(tmpdir(), "alpha-wallet-rehearsal-"));
  if (!isAbsolute(directory) || resolve(directory) === parse(directory).root || /[\0-\x1f]/.test(directory)) throw new Error("An absolute local rehearsal directory is required");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error("Rehearsal data must use a real directory");
  const files = await readdir(directory), marker = join(directory, CONTAINER_MARKER);
  if (!files.includes(CONTAINER_MARKER)) {
    if (files.length) throw new Error("Refusing an unmarked nonempty rehearsal directory");
    await writeFile(marker, MARKER_CONTENT, { flag: "wx", mode: 0o600 });
  }
  if (!(await lstat(marker)).isFile() || await readFile(marker, "utf8") !== MARKER_CONTENT) throw new Error("Invalid rehearsal directory marker");
  // The origin can be reused for an entirely different temporary wallet. Bind
  // retained browser operations to this durable container as well as its role.
  const identity = join(directory, CONTAINER_ID);
  try { await writeFile(identity, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
  const identityInfo = await lstat(identity);
  if (!identityInfo.isFile() || identityInfo.size !== 65) throw new Error("Invalid rehearsal directory identity");
  const savedIdentity = await readFile(identity, "utf8");
  if (!/^[a-f0-9]{64}\n$/.test(savedIdentity)) throw new Error("Invalid rehearsal directory identity");
  return { directory: resolve(directory), rehearsalId: savedIdentity.slice(0, -1) };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if ((req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
    req.resume(); return Promise.reject(new HttpError(415, "JSON_REQUIRED", "Send application/json"));
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
    req.resume(); return Promise.reject(new HttpError(413, "BODY_TOO_LARGE", "Request exceeds the local rehearsal body limit"));
  }
  return new Promise((yes, no) => {
    let size = 0, finished = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY) { finished = true; chunks.length = 0; no(new HttpError(413, "BODY_TOO_LARGE", "Request exceeds the local rehearsal body limit")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        yes(body as Record<string, unknown>);
      } catch { no(new HttpError(400, "INVALID_JSON", "Send a JSON object")); }
    });
    req.on("error", () => no(new HttpError(400, "INVALID_REQUEST", "Request body could not be read")));
  });
}

function fiat(minor: bigint) { const text = minor.toString().padStart(3, "0"); return `${text.slice(0, -2)}.${text.slice(-2)}`; }
function outputJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export type RehearsalServer = { url: string; dataDir: string; close(): Promise<void> };

export async function createRehearsalServer(options: { mode: "simulation-only"; dataDir?: string; port?: number }): Promise<RehearsalServer> {
  assertSimulationRuntime(options.mode);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid rehearsal port");
  const { directory: dataDir, rehearsalId } = await rehearsalDirectory(options.dataDir);
  const store = await createFileWalletStore({ mode: options.mode, dataDir: join(dataDir, "wallet") });
  try { await initializeDurableWallet(store); } catch (error) { await store.close(); throw error; }
  let provider: FileFakeProvider;
  try { provider = await createFileFakeProvider({ mode: options.mode, dataDir: join(dataDir, "provider") }); }
  catch (error) { await store.close(); throw error; }
  const wallet = createDurableWallet({ mode: options.mode, store });
  const sessions = new Map<string, Session>();
  let origin = "", closing = false;

  function session(req: IncomingMessage, res: ServerResponse): Session {
    const cookie = (req.headers.cookie ?? "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key);
    let selected = cookie && /^[a-f0-9]{64}$/.test(cookie) ? sessions.get(cookie) : undefined;
    if (!selected) {
      if (sessions.size >= 128) throw new HttpError(429, "SESSION_LIMIT", "Too many local fixture sessions");
      const token = randomBytes(32).toString("hex");
      selected = { role: "seller", csrf: randomBytes(32).toString("hex"), expires: now + SESSION_MS };
      sessions.set(token, selected);
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    }
    selected.expires = now + SESSION_MS;
    return selected;
  }

  async function view(current: Session) {
    const saved = await wallet.snapshot(), state = saved.state;
    const units = (asset: AssetId, value: bigint) => formatUnits(value, assetFor(asset).decimals);
    const payouts = await Promise.all([...state.payouts.values()].map(async payout => {
      const found = await provider.lookup(payout);
      const providerStatus = found.status === "finalized" ? found.receipt.successful ? "finalized_success" : "finalized_failure" : found.status;
      const held = balance(state, payout.assetId, `payout:${payout.id}`);
      return { id: payout.id, assetId: payout.assetId, kind: payout.kind, tradeId: payout.tradeId, amount: units(payout.assetId, payout.amountRaw), held: units(payout.assetId, held),
        state: payout.state, destination: payout.destination, providerReference: payout.providerReference, transactionId: payout.transactionId,
        dispatchCount: payout.dispatchCount, providerStatus,
        recovery: payout.state === "confirmed" ? "already_confirmed" : payout.state === "failed_final" ? "manual_recovery_required"
          : ["submitting", "submission_unknown", "broadcast"].includes(payout.state) ? "lookup_original_reference"
            : state.haltReason || (payout.tradeId && state.trades.get(payout.tradeId)?.disputed) ? "held_by_policy" : "requires_current_policy_checks" };
    }));
    const assets = Object.values(SANDBOX_ASSETS).map(asset => {
      const sumAccounts = (prefix: string) => [...state.accounts].filter(([key]) => key.startsWith(`${asset.id}|${prefix}`)).reduce((total, [, value]) => total + value, BigInt(0));
      const delivered = [...state.payouts.values()].filter(p => p.assetId === asset.id && p.kind === "trade" && p.state === "confirmed").reduce((total, p) => total + p.amountRaw, BigInt(0));
      const due = [...state.commissions.values()].filter(c => c.assetId === asset.id && !c.paid).reduce((total, c) => total + c.amountRaw, BigInt(0));
      const reconciliation = state.reconciliations.get(asset.id);
      return { id: asset.id, label: asset.id === "tron-sim-usdt" ? "TRC20 simulation" : "BEP20 simulation", decimals: asset.decimals,
        custody: units(asset.id, expectedCustody(state, asset.id)), available: units(asset.id, balance(state, asset.id, `available:${ACTORS.seller.id}`)),
        listing: units(asset.id, sumAccounts("listing:")), reserved: units(asset.id, sumAccounts("trade:") + sumAccounts("payout:")), delivered: units(asset.id, delivered),
        commissionAvailable: units(asset.id, balance(state, asset.id, `commission:${ACTORS.seller.id}`)), commissionDue: units(asset.id, due), revenue: units(asset.id, balance(state, asset.id, "platform-revenue")),
        gasReady: state.gasReady.has(asset.id), reconciliationFresh: Boolean(reconciliation && Date.now() >= reconciliation.at && Date.now() - reconciliation.at <= 60_000 && reconciliation.expectedRaw === expectedCustody(state, asset.id)) };
    });
    return { mode: "simulation-only", rehearsalId, role: current.role, roles: ROLES, csrf: current.csrf, revision: saved.revision, paused: state.haltReason, assets,
      listings: [...state.listings.values()].map(listing => ({ id: listing.id, assetId: listing.assetId, amount: units(listing.assetId, listing.amountRaw), available: units(listing.assetId, balance(state, listing.assetId, `listing:${listing.id}`)),
        price: listing.price, approved: listing.approved, funded: listing.funded, closed: listing.closed, status: listing.closed ? "closed" : !listing.approved ? "awaiting_owner" : !listing.funded ? "awaiting_funding" : balance(state, listing.assetId, `listing:${listing.id}`) > BigInt(0) ? "active" : "fully_reserved" })),
      funding: [...state.depositIntents.values()].map(intent => { const observation = [...state.deposits.values()].find(item => item.intentId === intent.id);
        return { id: intent.id, assetId: intent.assetId, purpose: intent.purpose, destination: intent.destination, amount: observation ? units(intent.assetId, BigInt(observation.amountRaw)) : null,
          status: !observation ? "created" : observation.credited ? "finalized" : "pending" }; }),
      trades: [...state.trades.values()].map(trade => ({ id: trade.id, listingId: trade.listingId, assetId: trade.assetId, amount: units(trade.assetId, trade.amountRaw), buyerFee: units(trade.assetId, trade.buyerFeeRaw), sellerFee: units(trade.assetId, trade.sellerFeeRaw),
        fiatTotal: fiat(trade.fiatTotalMinor), status: trade.status, disputed: trade.disputed, destination: trade.destination, payoutId: trade.payoutId })),
      payouts, journal: state.journal.slice(-16).reverse().map(entry => ({ id: entry.id, assetId: entry.assetId, operation: entry.operation,
        entries: entry.entries.map(item => ({ account: item.account, delta: units(entry.assetId, item.delta) })) })) };
  }

  async function perform(current: Session, input: Action) {
    if (!ACTION_ROLES[input.action].includes(current.role)) throw new HttpError(403, "WRONG_FIXTURE_ROLE", "This action belongs to a different fixture role");
    const actor = ACTORS[current.role];
    const command = <T extends WalletCommandType>(type: T, fields: CommandOf<T>["input"]) => wallet.execute(walletCommand(type, actor, input.requestId, fields));
    const objectId = (prefix: string) => `${prefix}-${walletDigest([actor.id, input.requestId]).slice(0, 24)}`;
    const state = (await wallet.snapshot()).state;
    const trade = (tradeId: string) => { const found = state.trades.get(tradeId); if (!found) throw new HttpError(404, "NOT_FOUND", "Trade not found"); return found; };
    const payout = (payoutId: string) => { const found = state.payouts.get(payoutId); if (!found) throw new HttpError(404, "NOT_FOUND", "Payout not found"); return found; };
    switch (input.action) {
      case "listing-create": await command("createListing", { id: objectId("listing"), assetId: input.assetId, amount: input.amount, price: input.price, currency: "ILS" }); break;
      case "funding-create": await command("createDepositIntent", { id: objectId("deposit"), assetId: input.assetId, purpose: input.purpose }); break;
      case "funding-observe": {
        const intent = state.depositIntents.get(input.intentId);
        if (!intent) throw new HttpError(404, "NOT_FOUND", "Funding intent not found");
        const prior = [...state.deposits.values()].find(item => item.intentId === intent.id);
        if (input.finalized && !prior) throw new HttpError(409, "PENDING_FIRST", "Record the pending synthetic observation before finalizing it");
        const asset = assetFor(intent.assetId);
        await command("observeDeposit", { intentId: intent.id, assetId: intent.assetId, network: asset.network, token: asset.token,
          transactionId: `sim-tx-${intent.id}`, eventIndex: 0, destination: intent.destination,
          amountRaw: parseUnits(input.amount, asset.decimals).toString(), blockHash: "sim-block-rehearsal", finalized: input.finalized, successful: true });
        break;
      }
      case "listing-approve": await command("approveListing", input.listingId); break;
      case "listing-close": await command("closeListing", input.listingId); break;
      case "trade-reserve": {
        const listing = state.listings.get(input.listingId);
        if (!listing) throw new HttpError(404, "NOT_FOUND", "Listing not found");
        await command("reserveTrade", { id: objectId("trade"), listingId: listing.id, amount: input.amount, destination: simulatedDestination(listing.assetId, ACTORS.buyer.id) }); break;
      }
      case "payment-claim": await command("markBuyerPaid", input.tradeId); break;
      case "payment-verify": {
        const item = trade(input.tradeId);
        await command("verifyPayment", { tradeId: item.id, evidence: { reference: `sim-evidence-${item.id}`, amountMinor: item.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } }); break;
      }
      case "release-authorize": await command("authorizeRelease", input.tradeId); break;
      case "trade-cancel": await command("cancelTrade", input.tradeId); break;
      case "trade-dispute": await command("openDispute", input.tradeId); break;
      case "custody-reconcile": {
        let observed = [...state.deposits.values()].filter(d => d.assetId === input.assetId && d.credited).reduce((total, d) => total + BigInt(d.amountRaw), BigInt(0));
        for (const item of state.payouts.values()) if (item.assetId === input.assetId) {
          const found = await provider.lookup(item);
          if (found.status === "finalized" && found.receipt.successful) observed -= item.amountRaw;
        }
        if (observed < BigInt(0)) throw new HttpError(409, "FIXTURE_MISMATCH", "Synthetic provider custody is inconsistent");
        await command("reconcileAsset", { assetId: input.assetId, observedRaw: observed.toString(), complete: true }); break;
      }
      case "gas-ready": await command("setNativeFeeReadiness", { assetId: input.assetId, ready: input.ready }); break;
      case "payout-queue": await command("queueRelease", input.tradeId); break;
      case "payout-claim-only": await command("beginDispatch", input.payoutId); break;
      case "payout-step": {
        payout(input.payoutId);
        const faultProvider = { ...provider, submit: (item: Parameters<typeof provider.submit>[0]) => provider.submit(item, { loseResponseAfterAccept: input.loseResponse }) };
        await createSimulationPayoutWorker({ mode: options.mode, wallet, provider: faultProvider }).step(input.payoutId); break;
      }
      case "payout-finalize": await provider.finalize(payout(input.payoutId), input.successful); break;
      case "withdrawal-create": await command("requestWithdrawal", { id: objectId("withdrawal"), assetId: input.assetId, amount: input.amount,
        destination: simulatedDestination(input.assetId, ACTORS.seller.id), stepUpReference: `sim-stepup-${objectId("approval")}` }); break;
      case "wallet-pause": await command("pause", null); break;
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      let attemptedAction: Action["action"] | null = null;
      let actionCompleted = false;
      let roleChanged = false;
      const nonce = randomBytes(24).toString("hex");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
      try {
        assertSimulationRuntime(options.mode);
        if (closing) throw new HttpError(503, "CLOSING", "Rehearsal is closing");
        if (req.headers.host !== origin.slice("http://".length) || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
          throw new HttpError(403, "LOOPBACK_REQUIRED", "Only the exact local rehearsal origin is accepted");
        }
        if (!req.url?.startsWith("/") || req.url.startsWith("//") || req.url.includes("?")) throw new HttpError(404, "NOT_FOUND", "Unknown rehearsal route");
        if (!["GET", "POST"].includes(req.method ?? "")) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))) throw new HttpError(403, "ORIGIN_REQUIRED", "Cross-origin rehearsal requests are refused");
        const current = session(req, res);
        if (req.method === "GET" && req.url === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(rehearsalPage(nonce)); return;
        }
        if (req.method === "GET" && req.url === "/api/state") { outputJson(res, 200, await view(current)); return; }
        if (req.method !== "POST") throw new HttpError(404, "NOT_FOUND", "Unknown rehearsal route");
        if (req.headers.origin !== origin) throw new HttpError(403, "ORIGIN_REQUIRED", "The exact local Origin is required");
        const csrf = req.headers["x-alpha-rehearsal-csrf"];
        if (typeof csrf !== "string" || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf))) {
          throw new HttpError(403, "CSRF_REQUIRED", "Refresh the rehearsal session before this action");
        }
        if (req.headers["x-alpha-rehearsal-id"] !== rehearsalId) {
          throw new HttpError(409, "REHEARSAL_CONTEXT_CHANGED", "This operation belongs to a different local rehearsal. Reopen its original data directory before recovery.");
        }
        const body = await readBody(req);
        if (req.url === "/api/session/role") {
          current.role = z.strictObject({ role: z.enum(ROLES) }).parse(body).role;
          roleChanged = true;
        } else {
          if (Object.keys(body).some(key => ["actor", "action", "command", "type", "userId", "role"].includes(key))) throw new HttpError(400, "SERVER_IDENTITY_ONLY", "Actors and commands cannot be supplied by the browser");
          const action = req.url.match(/^\/api\/actions\/([a-z-]+)$/)?.[1];
          if (!action || !Object.hasOwn(ACTION_ROLES, action)) throw new HttpError(404, "NOT_FOUND", "Unknown rehearsal action");
          const input = actionSchema.parse({ ...body, action });
          attemptedAction = input.action;
          await perform(current, input);
          actionCompleted = true;
        }
        outputJson(res, 200, await view(current));
      } catch (error) {
        if (res.headersSent) { res.end(); return; }
        // A failed response projection can follow a successful commit. Worker
        // and provider actions can also have durable intermediate effects.
        // Their exceptions must never be presented as evidence of rollback.
        const outcome = error instanceof CommitOutcomeUnknownError || actionCompleted || roleChanged
          || attemptedAction === "payout-step" || attemptedAction === "payout-finalize" ? "unknown" : "not_applied";
        if (error instanceof HttpError) outputJson(res, error.status, { error: error.code, outcome, message: error.message });
        else if (error instanceof z.ZodError) outputJson(res, 400, { error: "INVALID_FIELDS", outcome, message: "Unexpected or invalid rehearsal action fields" });
        else if (error instanceof CommitOutcomeUnknownError) outputJson(res, 409, { error: error.code, outcome, message: "Commit acknowledgement is unknown. Recover the same operation; do not create a replacement payout." });
        else outputJson(res, 409, { error: "ACTION_HELD", outcome, message: error instanceof Error ? error.message : "Rehearsal action was held" });
      }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 40;
  try {
    assertSimulationRuntime(options.mode);
    await new Promise<void>((yes, no) => {
      server.once("error", no);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        server.off("error", no);
        const address = server.address();
        if (!address || typeof address === "string") { no(new Error("Local server address unavailable")); return; }
        origin = `http://127.0.0.1:${address.port}`; yes();
      });
    });
  } catch (error) { await store.close(); throw error; }
  let closePromise: Promise<void> | undefined;
  return Object.freeze({ url: origin, dataDir, close() {
    if (!closePromise) {
      closing = true;
      closePromise = new Promise<void>((yes, no) => { server.close(error => error ? no(error) : yes()); server.closeIdleConnections(); }).finally(() => store.close());
    }
    return closePromise;
  } });
}

async function main() {
  const args = process.argv.slice(2);
  const options: { mode: "simulation-only"; dataDir?: string; port: number } = { mode: "simulation-only", port: 4318 };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--data-dir", "--port"].includes(name) || !value || seen.has(name)) throw new Error("Use optional --data-dir <absolute local directory> and --port <local port>");
    seen.add(name);
    if (name === "--data-dir") options.dataDir = value;
    else if (/^\d{1,5}$/.test(value)) options.port = Number(value);
    else throw new Error("Invalid local rehearsal port");
  }
  const app = await createRehearsalServer(options);
  console.log(JSON.stringify({ mode: "simulation-only", url: app.url, dataDir: app.dataDir, notice: "Synthetic fixtures only. Role switching is not account authentication. No real funds, chain calls, or signer." }));
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void app.close().then(() => process.exit(0), () => process.exit(1)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/alpha-wallet/rehearsal-server.ts")) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : "Local rehearsal failed"); process.exitCode = 1; });
}
