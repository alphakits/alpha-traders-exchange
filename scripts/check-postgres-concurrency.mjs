import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import pg from "pg";

const output = path.resolve("test-results/postgres-concurrency");
await mkdir(output, { recursive: true });
const workerFile = path.resolve("tmp/postgres-audit/worker.cjs");
await build({ entryPoints: ["scripts/integration/exchange-worker.ts"], outfile: workerFile, bundle: true,
  platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", sourcemap: true,
  alias: { "server-only": path.resolve("src/test/server-only.ts"),
    "@/lib/postgres-runtime": path.resolve("scripts/integration/postgres-runtime.ts"),
    "@alpha-traders/contracts": path.resolve("packages/contracts/src/index.ts") } });
if (process.argv.includes("--build-only")) { console.log("Isolated PostgreSQL harness bundled; no database tests executed."); process.exit(0); }

const connectionString = process.env.ALPHA_AUDIT_DATABASE_URL ?? "";
const target = new URL(connectionString);
assert(["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/alpha_exchange_ci" && target.username === "postgres", "Dedicated loopback database required");
const pool = new pg.Pool({ connectionString, max: 2, application_name: "alpha-audit-controller" });
let sequence = 0;
const timings = [];
const workers = [];
const checks = [];
let peakActiveConnections = 0;
function startWorker(index) {
  const child = fork(workerFile, [], { env: { PATH: process.env.PATH, NODE_ENV: "production",
    ALPHA_AUDIT_DATABASE_URL: connectionString, ALPHA_AUDIT_WORKER_ID: String(index),
    DATABASE_URL: connectionString, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated-ci-placeholder", SUPABASE_SERVICE_ROLE_KEY: "isolated-ci-placeholder-no-provider-access",
    ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET: "isolated-ci-synthetic-cardless-key-0001",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const pending = new Map();
  child.on("message", message => {
    const task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timeout); pending.delete(message.id);
    timings.push({ operation: task.operation, ok: message.ok, elapsedMs: message.elapsedMs, worker: index });
    task.resolve(message);
  });
  child.on("exit", (code, signal) => {
    for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error(`Audit worker exited (${code}/${signal})`)); }
    pending.clear();
  });
  return { child, call(operation, input) { return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${operation} exceeded 60 seconds`)); }, 60_000);
    pending.set(id, { resolve, reject, timeout, operation }); child.send({ id, operation, input });
  }); } };
}
function passed(name, details) { checks.push({ name, status: "PASS", details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`); }
function requireOk(result) { assert.equal(result.ok, true, `${result.code ?? ""}: ${result.error ?? ""}`); return result.result; }
async function batch(commands) {
  return Promise.all(commands.map((command, index) => workers[index % workers.length].call(command.operation, command.input)));
}
const now = new Date().toISOString();
function user(id, seller, index) {
  const phone = `+97250${String(index).padStart(7, "0")}`;
  return { id, fullName: `Synthetic ${id}`, email: `${id}@example.test`, passwordHash: "synthetic-no-login",
    whatsappNumber: phone, verifiedPhone: phone, phoneVerifiedAt: now, emailVerified: true, emailVerifiedAt: now,
    role: seller ? "approved_seller" : "buyer", roles: [seller ? "approved_seller" : "buyer"], sellerStatus: seller ? "approved_seller" : "buyer",
    sellerApprovalVerification: seller ? { method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true,
      liveIdentityVideoReviewed: true, contactOwnershipConfirmed: true, marketplaceRulesAccepted: true,
      verifiedAt: now, verifiedByUserId: "synthetic-reviewer" } : undefined,
    availabilityStatus: "available", onlineStatus: "online", createdAt: now, updatedAt: now, preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Face-to-Face (Meet in Person)"], profilePhotoUrl: "", languages: ["English"], bio: "",
    country: "Israel", city: "", coverBannerUrl: "", isFeaturedSeller: false, isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false }, lifetimeCompletedVolumeUsdt: 0, sellerPrestigeRank: "bronze", sellerPromotionHistory: [], sellerAchievements: [] };
}
const fixture = { users: [], marketplaceListings: [], purchaseRequests: [] };
for (let sellerIndex = 0; sellerIndex < 15; sellerIndex++) {
  const sellerId = `audit-seller-${sellerIndex}`;
  fixture.users.push(user(sellerId, true, sellerIndex + 1));
  const method = ["Face-to-Face (Meet in Person)", "Bank Transfer", "Cardless ATM Withdrawal"][sellerIndex % 3];
  const atm = method === "Cardless ATM Withdrawal";
  const listingId = `audit-listing-${sellerIndex}`;
  const bank = { id: `bank-${sellerIndex}`, accountHolderName: `Synthetic ${sellerId}`, bankName: "Synthetic Test Bank", branchNumber: "123", accountNumber: "12345678", accountLast4: "5678" };
  fixture.marketplaceListings.push({ id: listingId, sellerId, sellerDisplayName: sellerId, photos: [], originalAmount: "2000", availableAmount: "2000",
    price: atm ? "3.10" : "3.20", currency: "ILS", network: "TRC20", paymentMethod: method, paymentMethods: [method], minimumTrade: "50", maximumTrade: "1000",
    sellerDescription: "Controlled CI data", responseTime: "", status: "active", approvalStatus: "approved", sellerBankAccountId: bank.id,
    bankAccountSnapshot: bank, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
  for (let buyerIndex = 0; buyerIndex < 4; buyerIndex++) {
    const buyerId = `audit-buyer-${sellerIndex}-${buyerIndex}`;
    fixture.users.push(user(buyerId, false, 100 + sellerIndex * 4 + buyerIndex));
    fixture.purchaseRequests.push({ id: `audit-request-${sellerIndex}-${buyerIndex}`, listingId, sellerId, buyerId, buyerName: buyerId,
      usdtAmount: atm ? "415.202811" : "250", pricePerUsdt: atm ? "3.10" : "3.20", listingPriceAtRequest: atm ? "3.10" : "3.20",
      fiatAmount: atm ? "1300.00" : "808.00", currency: "ILS", network: "TRC20", paymentMethod: method,
      feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2", sellerSafetyAcknowledged: true,
      sellerBankAccountId: bank.id, sellerBankAccountSnapshot: bank, buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      status: "pending", timeline: [], createdAt: now, updatedAt: now });
  }
}
const sellerCommand = (request, nextStatus) => ({ operation: "status", input: { requestId: request.id, actorUserId: request.sellerId, actorRole: "approved_seller", nextStatus, safetyAcknowledged: true } });
const buyerCommand = (request, nextStatus) => ({ operation: "status", input: { requestId: request.id, actorUserId: request.buyerId, actorRole: "buyer", nextStatus } });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZwAAAABJRU5ErkJggg==";
function evidence(request, side) { return { operation: "evidence", input: { purchaseRequestId: request.id, actorUserId: side === "buyer" ? request.buyerId : request.sellerId,
  actorRole: side === "buyer" ? "buyer" : "approved_seller", side, fileName: "synthetic-receipt.png", mimeType: "image/png", sizeBytes: Buffer.from(png, "base64").length, contentBase64: png } }; }
let monitor;
try {
  // Initialize schema before starting the remaining independent processes.
  workers.push(startWorker(0)); const runtime = requireOk(await workers[0].call("ready"));
  const baselineMigration = await readFile("supabase/migrations/20261017003000_runtime_table_baseline.sql", "utf8");
  await pool.query(baselineMigration);
  requireOk(await workers[0].call("seed", fixture));
  await pool.query(baselineMigration);
  const expectedSchema = JSON.parse(await readFile("scripts/integration/runtime-table-baseline.json", "utf8"));
  const observedSchema = await pool.query(`select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
    (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity) order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
    (select jsonb_agg(jsonb_build_object('name',co.conname,'definition',pg_get_constraintdef(co.oid)) order by co.conname) from pg_constraint co where co.conrelid=c.oid) as constraints
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='alpha_exchange' and c.relkind='r' and c.relname=any($1::text[]) order by c.relname`, [expectedSchema.map(row => row.table_name)]);
  assert.deepEqual(observedSchema.rows, expectedSchema.map(({ table_name, rls, force_rls, columns, constraints }) => ({ table_name, rls, force_rls, columns, constraints })));
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.users")).rows[0].n, 75);
  passed("Runtime/legacy baseline recreates 11 observed table definitions and replays without deleting seeded accounts", { tables: 11, users: 75 });
  for (let index = 1; index < 4; index++) workers.push(startWorker(index));
  (await Promise.all(workers.map(worker => worker.call("ready")))).forEach(requireOk);
  monitor = setInterval(() => { pool.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and application_name like 'alpha-audit-worker-%' and state='active'")
    .then(result => { peakActiveConnections = Math.max(peakActiveConnections, result.rows[0].n); }).catch(() => {}); }, 100);

  const first = fixture.purchaseRequests[0];
  const terms = { requestId: first.id, actorUserId: first.sellerId, action: "propose_amount", value: "200", expectedUpdatedAt: first.updatedAt };
  const racedTerms = await batch(Array.from({ length: 3 }, () => ({ operation: "terms", input: terms })));
  assert.equal(racedTerms.filter(result => result.ok).length, 1);
  let snapshot = requireOk(await workers[0].call("snapshot"));
  let current = snapshot.purchaseRequests.find(request => request.id === first.id);
  assert.equal(current.amountAdjustmentCount, 1);
  requireOk(await workers[1].call("terms", { requestId: first.id, actorUserId: first.buyerId, action: "accept_amount", proposalId: current.termsProposal.id }));
  current = requireOk(await workers[0].call("snapshot")).purchaseRequests.find(request => request.id === first.id);
  requireOk(await workers[2].call("terms", { ...terms, value: "250", expectedUpdatedAt: current.updatedAt }));
  current = requireOk(await workers[0].call("snapshot")).purchaseRequests.find(request => request.id === first.id);
  requireOk(await workers[3].call("terms", { requestId: first.id, actorUserId: first.buyerId, action: "accept_amount", proposalId: current.termsProposal.id }));
  current = requireOk(await workers[0].call("snapshot")).purchaseRequests.find(request => request.id === first.id);
  assert.equal((await workers[0].call("terms", { ...terms, expectedUpdatedAt: current.updatedAt })).ok, false);
  assert.equal(current.amountAdjustmentCount, 2);
  passed("Concurrent adjustments and durable two-submission limit", { processes: 4, submitted: 2 });

  const accepted = await batch(fixture.purchaseRequests.map(request => sellerCommand(request, "accepted")));
  snapshot = requireOk(await workers[0].call("snapshot"));
  const active = snapshot.purchaseRequests.filter(request => request.status === "accepted");
  assert.equal(active.length, 45, JSON.stringify(accepted.filter(result => !result.ok).map(result => ({ code: result.code, error: result.error }))));
  for (const seller of fixture.users.filter(row => row.role === "approved_seller")) assert.equal(active.filter(request => request.sellerId === seller.id).length, 3);
  assert.equal(snapshot.commissionRecords.length, 0);
  assert.equal(new Set(active.map(request => request.tradeId)).size, 45);
  passed("15 concurrent sellers, 60 buyer requests, three accepted per seller", { accepted: 45, blocked: 15, prematureCommissions: 0 });

  // Independent application instances restart while trades are active.
  for (const worker of workers) worker.child.kill("SIGKILL");
  workers.splice(0, workers.length, ...Array.from({ length: 4 }, (_, index) => startWorker(index + 4)));
  (await Promise.all(workers.map(worker => worker.call("ready")))).forEach(requireOk);
  assert.equal(requireOk(await workers[0].call("snapshot")).purchaseRequests.filter(request => request.status === "accepted").length, 45);
  passed("Application process restart preserves all accepted trades", { trades: 45 });
  const forbidden = await batch(active.map(request => buyerCommand(request, "completed")));
  assert(forbidden.every(result => !result.ok && result.code === "seller-completion-required"));
  passed("Buyer cannot complete any payment method", { rejected: forbidden.length });

  const paymentCommands = active.map(request => request.paymentMethod === "Bank Transfer" ? evidence(request, "buyer")
    : request.paymentMethod === "Cardless ATM Withdrawal" ? { ...buyerCommand(request, "payment_sent"), input: { ...buyerCommand(request, "payment_sent").input,
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: "phone", cardlessVerificationValue: "0501234567", clientOperationId: randomUUID() } }
      : buyerCommand(request, "funds_received"));
  (await batch(paymentCommands)).forEach(requireOk);
  (await batch(active.filter(request => request.paymentMethod !== "Face-to-Face (Meet in Person)").map(request => sellerCommand(request, "funds_received")))).forEach(requireOk);
  const locked = await batch(active.map(request => ({ operation: "terms", input: { requestId: request.id, actorUserId: request.sellerId, action: "propose_amount", value: "100", expectedUpdatedAt: request.updatedAt } })));
  assert(locked.every(result => !result.ok));
  passed("All payment methods reach cash/funds receipt; late adjustments rejected", { trades: 45 });
  (await batch(active.map(request => request.paymentMethod === "Bank Transfer" ? evidence(request, "seller") : sellerCommand(request, "usdt_sent")))).forEach(requireOk);
  const completion = active.flatMap(request => Array.from({ length: 2 }, () => ({ operation: "status", input: { ...sellerCommand(request, "completed").input, completionMode: "seller", usdtSentConfirmed: true } })));
  (await batch(completion)).forEach(requireOk);
  snapshot = requireOk(await workers[0].call("snapshot"));
  assert.equal(snapshot.commissionRecords.length, 45);
  assert.equal(new Set(snapshot.commissionRecords.map(record => record.purchaseRequestId)).size, 45);
  assert.equal(snapshot.purchaseRequests.filter(request => request.completedAt).length, 45);
  for (const listing of snapshot.marketplaceListings) {
    const completed = snapshot.purchaseRequests.filter(request => request.listingId === listing.id && request.completedAt);
    const soldMicros = completed.reduce((sum, request) => sum + Math.round(Number(request.usdtAmount) * 1e6), 0);
    assert.equal(Math.round(Number(listing.availableAmount) * 1e6), 2_000_000_000 - soldMicros);
    assert(Number(listing.availableAmount) > 0);
    for (const request of completed) {
      const fee = Math.floor((Math.round(Number(request.usdtAmount) * 1e6) + 50) / 100);
      const record = snapshot.commissionRecords.find(row => row.purchaseRequestId === request.id);
      assert.equal(Math.round(record.commissionAmount * 1e6), 2 * fee);
    }
  }
  passed("Duplicate completion settles and deducts inventory exactly once", { submissions: 90, trades: 45, commissions: 45 });

  const before = snapshot.marketplaceListings[0];
  requireOk(await workers[0].call("hold-uncommitted-write", before.id));
  workers[0].child.kill("SIGKILL"); workers[0] = startWorker(8);
  requireOk(await workers[0].call("ready"));
  const recovered = requireOk(await workers[0].call("snapshot"));
  assert.equal(recovered.marketplaceListings.find(row => row.id === before.id).availableAmount, before.availableAmount);
  passed("Killed process rolls back its unfinished database transaction", { listing: before.id, availableAmount: before.availableAmount });
  assert(peakActiveConnections >= 2, `No overlapping PostgreSQL activity observed: ${peakActiveConnections}`);
  passed("Observed simultaneous database activity across independent processes", { peakActiveConnections });
  await writeFile(path.join(output, "runtime.json"), JSON.stringify(runtime, null, 2));
} catch (error) {
  checks.push({ name: "Database concurrency run", status: "FAIL", error: error.stack ?? String(error) });
  console.error(error); process.exitCode = 1;
} finally {
  clearInterval(monitor);
  for (const worker of workers) worker.child.kill("SIGKILL");
  await pool.end();
  const durations = timings.filter(row => row.ok && row.operation === "status").map(row => row.elapsedMs).sort((a, b) => a - b);
  const percentile = fraction => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(fraction * durations.length) - 1)] : null;
  await writeFile(path.join(output, "results.json"), JSON.stringify({ commit: process.env.GITHUB_SHA ?? null, checks, peakActiveConnections,
    serverActionTiming: { count: durations.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1),
      scope: "Direct business-engine actions against loopback PostgreSQL, including concurrent lock waiting; excludes browser and external delivery" }, timings }, null, 2));
}
