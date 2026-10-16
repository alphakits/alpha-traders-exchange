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
const queryMetrics = [];
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
    timings.push({ operation: task.operation, requestId: task.input?.requestId, nextStatus: task.input?.nextStatus,
      ok: message.ok, code: message.code, details: message.details, elapsedMs: message.elapsedMs,
      actionElapsedMs: message.result?.actionElapsedMs, backgroundElapsedMs: message.result?.backgroundElapsedMs,
      metrics: message.result?.metrics, worker: index });
    task.resolve(message);
  });
  child.on("exit", (code, signal) => {
    for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error(`Audit worker exited (${code}/${signal})`)); }
    pending.clear();
  });
  return { child, call(operation, input) { return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${operation} exceeded 60 seconds`)); }, 60_000);
    pending.set(id, { resolve, reject, timeout, operation, input }); child.send({ id, operation, input });
  }); } };
}
function passed(name, details) { checks.push({ name, status: "PASS", details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`); }
function requireOk(result) { assert.equal(result.ok, true, `${result.code ?? ""}: ${result.error ?? ""}`); return result.result; }
async function batch(commands) {
  return Promise.all(commands.map((command, index) => workers[index % workers.length].call(command.operation, command.input)));
}
async function captureQueryMetrics(phase) {
  queryMetrics.push({ phase, workers: (await Promise.all(workers.map(worker => worker.call("query-timings")))).map(requireOk) });
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
fixture.users.push({ ...user("audit-owner", false, 900), role: "owner", roles: ["owner", "admin"] });
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
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.users")).rows[0].n, 76);
  passed("Runtime/legacy baseline recreates 11 observed table definitions and replays without deleting seeded accounts", { tables: 11, users: 76 });
  for (let index = 1; index < 4; index++) workers.push(startWorker(index));
  (await Promise.all(workers.map(worker => worker.call("ready")))).forEach(requireOk);
  monitor = setInterval(() => { pool.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and application_name like 'alpha-audit-worker-%' and state='active'")
    .then(result => { peakActiveConnections = Math.max(peakActiveConnections, result.rows[0].n); }).catch(() => {}); }, 100);

  const authAccounts = ["audit-buyer-0-0", "audit-buyer-0-1"];
  (await batch(authAccounts.map((userId, index) => ({ operation: "auth-password", input: { userId, passwordHash: `synthetic-updated-hash-${index}` } })))).forEach(requireOk);
  const authSnapshot = requireOk(await workers[0].call("snapshot"));
  authAccounts.forEach((userId, index) => assert.equal(authSnapshot.users.find(user => user.id === userId).passwordHash, `synthetic-updated-hash-${index}`));
  passed("Concurrent password updates preserve both accounts", { accounts: 2 });
  const bankInput = { sellerId: "audit-seller-0", actorUserId: "audit-seller-0", accountHolderName: "Synthetic Seller",
    bankName: "Synthetic Bank", branchNumber: "123", accountNumber: "1234567890" };
  const bankChanges = await batch([
    ...Array.from({ length: 3 }, () => ({ operation: "bank-add", input: bankInput })),
    { operation: "auth-password", input: { userId: bankInput.sellerId, passwordHash: "synthetic-bank-password" } },
  ]);
  assert.equal(bankChanges.slice(0, 3).filter(result => result.ok).length, 2);
  assert.equal(bankChanges.slice(0, 3).filter(result => !result.ok && /up to 2 bank accounts/.test(result.error)).length, 1);
  requireOk(bankChanges[3]);
  let bankSeller = requireOk(await workers[0].call("snapshot")).users.find(user => user.id === bankInput.sellerId);
  assert.equal(bankSeller.passwordHash, "synthetic-bank-password");
  assert.equal(bankSeller.sellerBankAccounts.length, 2);
  assert.equal(bankSeller.sellerBankAccounts.filter(account => account.isDefault).length, 1);
  const bankIds = bankSeller.sellerBankAccounts.map(account => account.id);
  (await batch(bankIds.map((bankAccountId, index) => ({ operation: "bank-update",
    input: { ...bankInput, bankAccountId, branchNumber: String(400 + index) } })))).forEach(requireOk);
  const bankSnapshot = requireOk(await workers[0].call("snapshot"));
  bankSeller = bankSnapshot.users.find(user => user.id === bankInput.sellerId);
  bankIds.forEach((id, index) => assert.equal(bankSeller.sellerBankAccounts.find(account => account.id === id).branchNumber, String(400 + index)));
  assert.equal(bankSnapshot.auditLogs.filter(log => log.targetUserId === bankInput.sellerId && log.action.startsWith("seller_bank_account_")).length, 4);
  (await batch(bankIds.map(bankAccountId => ({ operation: "bank-delete", input: { ...bankInput, bankAccountId } })))).forEach(requireOk);
  assert.equal(requireOk(await workers[0].call("snapshot")).users.find(user => user.id === bankInput.sellerId).sellerBankAccounts.length, 0);
  passed("Concurrent bank changes preserve account security, enforce two slots and retain both edits", { independentProcesses: 4,
    additions: 2, rejected: 1, edits: 2, deletions: 2, defaultAccountsAfterAddition: 1, passwordPreserved: true });
  const profileCommand = { sellerId: bankInput.sellerId, adminUserId: "audit-owner" };
  (await batch([
    { operation: "admin-profile", input: { ...profileCommand, feature: true } },
    { operation: "admin-profile", input: { ...profileCommand, hidden: true } },
    { operation: "auth-password", input: { userId: bankInput.sellerId, passwordHash: "synthetic-profile-password" } },
  ])).forEach(requireOk);
  const profileSnapshot = requireOk(await workers[0].call("snapshot"));
  const profileSeller = profileSnapshot.users.find(user => user.id === bankInput.sellerId);
  assert.equal(profileSeller.isFeaturedSeller, true);
  assert.equal(profileSeller.isProfileHidden, true);
  assert.equal(profileSeller.passwordHash, "synthetic-profile-password");
  assert.equal(profileSnapshot.auditLogs.filter(log => log.targetUserId === bankInput.sellerId && ["seller_featured", "seller_hidden"].includes(log.action)).length, 2);
  requireOk(await workers[0].call("admin-profile", { ...profileCommand, feature: false, hidden: false }));
  passed("Concurrent owner profile controls retain visibility, featured status and password changes", { independentProcesses: 3, auditRecords: 2, fixtureRestored: true });
  const administration = { actorUserId: "audit-owner", userId: authAccounts[0], reason: "Controlled concurrent account check" };
  (await batch([
    { operation: "admin-role", input: { ...administration, role: "admin" } },
    { operation: "admin-disable", input: { ...administration, disabled: true } },
    { operation: "admin-vacation", input: { ...administration, enabled: true } },
    { operation: "auth-password", input: { userId: authAccounts[0], passwordHash: "synthetic-concurrent-password" } },
  ])).forEach(requireOk);
  const administrated = requireOk(await workers[0].call("snapshot"));
  const administratedAccount = administrated.users.find(user => user.id === authAccounts[0]);
  assert.equal(administratedAccount.role, "admin");
  assert.equal(administratedAccount.disabled, true);
  assert.equal(administratedAccount.availabilityStatus, "vacation");
  assert.equal(administratedAccount.passwordHash, "synthetic-concurrent-password");
  assert.equal(administrated.auditLogs.filter(log => log.targetUserId === authAccounts[0]).length, 3);
  (await batch([
    { operation: "admin-role", input: { ...administration, role: "buyer" } },
    { operation: "admin-disable", input: { ...administration, disabled: false } },
    { operation: "admin-vacation", input: { ...administration, enabled: false } },
  ])).forEach(requireOk);
  passed("Concurrent account controls preserve password, role, restriction and availability changes", { independentProcesses: 4, committedAuditRecords: 3, fixtureRestored: true });

  const broadcast = { actorUserId: "audit-owner", reason: "Controlled durable audit check", type: "warning",
    titleEn: "Synthetic audit broadcast", bodyEn: "Controlled database only", titleAr: "إشعار تجريبي", bodyAr: "اختبار قاعدة البيانات فقط" };
  await pool.query(`create function alpha_exchange.audit_test_reject_broadcast() returns trigger language plpgsql as $$
    begin if new.payload->>'details' = 'Broadcast notification sent: Synthetic audit broadcast' then
      raise exception 'Synthetic broadcast audit failure'; end if; return new; end $$`);
  await pool.query("create trigger audit_test_reject_broadcast before insert on alpha_exchange.audit_logs for each row execute function alpha_exchange.audit_test_reject_broadcast()");
  const failedBroadcast = await workers[0].call("admin-broadcast", broadcast);
  assert.equal(failedBroadcast.ok, false);
  assert.match(failedBroadcast.error, /Synthetic broadcast audit failure/);
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.notifications where payload->>'titleEn'=$1", [broadcast.titleEn])).rows[0].n, 0);
  await pool.query("drop trigger audit_test_reject_broadcast on alpha_exchange.audit_logs");
  await pool.query("drop function alpha_exchange.audit_test_reject_broadcast()");
  requireOk(await workers[1].call("admin-broadcast", broadcast));
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.notifications where payload->>'titleEn'=$1", [broadcast.titleEn])).rows[0].n, 76);
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.audit_logs where payload->>'details'=$1", [`Broadcast notification sent: ${broadcast.titleEn}`])).rows[0].n, 1);
  passed("Broadcast audit failure rolls back all recipients and another process safely retries", { recipients: 76, auditRecords: 1, externalDelivery: "disabled" });
  (await batch(Array.from({ length: 4 }, () => ({ operation: "phone-attempt", input: authAccounts[0] })))).forEach(requireOk);
  assert.equal(requireOk(await workers[0].call("snapshot")).users.find(user => user.id === authAccounts[0]).buyerVerificationAttempts, 4);
  const phoneChallenges = await batch(Array.from({ length: 6 }, () => ({ operation: "phone-challenge", input: {
    userId: authAccounts[0], firstName: "Controlled", lastName: "Account",
    phone: fixture.users.find(user => user.id === authAccounts[0]).verifiedPhone,
  } })));
  assert.equal(phoneChallenges.filter(result => result.ok).length, 5);
  assert.equal(phoneChallenges.filter(result => !result.ok && /OTP send limit/.test(result.error)).length, 1);
  assert.equal(requireOk(await workers[0].call("snapshot")).users.find(user => user.id === authAccounts[0]).buyerOtpSendsToday, 5);
  passed("Phone challenge and attempt counters cannot be bypassed across processes", { attempts: 4, simultaneousChallenges: 6, allowed: 5, rejected: 1, actualSmsSent: 0 });
  const verification = requireOk(await workers[0].call("auth-email-issue", authAccounts[0]));
  const verifications = (await Promise.all(workers.map(worker => worker.call("auth-email-consume", verification.token)))).map(requireOk);
  assert.equal(verifications.filter(result => result.status === "verified").length, 1);
  assert.equal(verifications.filter(result => result.status === "invalid").length, 3);
  passed("Email verification token is consumed once across independent processes", { attempts: 4, verified: 1 });
  const resetInputs = authAccounts.map(userId => ({ userId, token: randomUUID() }));
  (await batch(resetInputs.map(input => ({ operation: "auth-reset-issue", input })))).forEach(requireOk);
  assert.equal(requireOk(await workers[0].call("snapshot")).passwordResetTokens.length, 2);
  for (const { token } of resetInputs) {
    const consumed = (await Promise.all(workers.map(worker => worker.call("auth-reset-consume", token)))).map(requireOk);
    assert.equal(consumed.filter(Boolean).length, 1);
  }
  assert.equal(requireOk(await workers[0].call("snapshot")).passwordResetTokens.length, 0);
  passed("Password reset issuance preserves other accounts and each token is single-use across processes", { accounts: 2, attemptsPerToken: 4 });

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

  // A retained request must never be transiently deleted during snapshot
  // replacement. Such a deletion can silently cascade a dependent record.
  await pool.query("create table alpha_exchange.audit_reference_probe(request_id text primary key references alpha_exchange.purchase_requests(id) on delete cascade)");
  await pool.query("insert into alpha_exchange.audit_reference_probe select unnest($1::text[])", [active.map(request => request.id)]);

  // Independent application instances restart while trades are active.
  await captureQueryMetrics("acceptance-before-process-restart");
  for (const worker of workers) worker.child.kill("SIGKILL");
  workers.splice(0, workers.length, ...Array.from({ length: 4 }, (_, index) => startWorker(index + 4)));
  (await Promise.all(workers.map(worker => worker.call("ready")))).forEach(requireOk);
  assert.equal(requireOk(await workers[0].call("snapshot")).purchaseRequests.filter(request => request.status === "accepted").length, 45);
  passed("Application process restart preserves all accepted trades", { trades: 45 });
  const forbidden = await batch(active.map(request => buyerCommand(request, "completed")));
  assert(forbidden.every(result => !result.ok && result.code === "seller-completion-required"));
  passed("Buyer cannot complete any payment method", { rejected: forbidden.length });

  const invalidAtmDetails = await batch(active.filter(request => request.paymentMethod === "Cardless ATM Withdrawal").map(request => ({
    ...buyerCommand(request, "payment_sent"), input: { ...buyerCommand(request, "payment_sent").input,
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: "phone", cardlessVerificationValue: "0501234567", clientOperationId: randomUUID() },
  })));
  assert(invalidAtmDetails.every(result => !result.ok && result.code === "cardless-verification-required"));
  passed("ATM rejects unsupported identification details before advancing payment", { rejected: invalidAtmDetails.length });

  const paymentCommands = active.map(request => request.paymentMethod === "Bank Transfer" ? evidence(request, "buyer")
    : request.paymentMethod === "Cardless ATM Withdrawal" ? { ...buyerCommand(request, "payment_sent"), input: { ...buyerCommand(request, "payment_sent").input,
      cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth", cardlessVerificationValue: "25/08/1995", clientOperationId: randomUUID() } }
      : buyerCommand(request, "funds_received"));
  (await batch(paymentCommands)).forEach(requireOk);
  (await batch(active.filter(request => request.paymentMethod !== "Face-to-Face (Meet in Person)").map(request => sellerCommand(request, "funds_received")))).forEach(requireOk);
  const locked = await batch(active.map(request => ({ operation: "terms", input: { requestId: request.id, actorUserId: request.sellerId, action: "propose_amount", value: "100", expectedUpdatedAt: request.updatedAt } })));
  assert(locked.every(result => !result.ok));
  passed("All payment methods reach cash/funds receipt; late adjustments rejected", { trades: 45 });
  (await batch(active.filter(request => request.paymentMethod === "Bank Transfer").map(request => sellerCommand(request, "usdt_release_pending")))).forEach(requireOk);
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
  assert.equal((await pool.query("select count(*)::int as n from alpha_exchange.audit_reference_probe")).rows[0].n, 45);
  passed("Retained trade references survive every lifecycle write and process restart", { references: 45 });

  const manualCommand = { sellerId: "audit-seller-0", actorUserId: "audit-owner", commissionAmount: 7.25,
    reason: "Synthetic owner assignment", clientOperationId: randomUUID() };
  const assignments = await batch(Array.from({ length: 8 }, () => ({ operation: "manual-commission", input: manualCommand })));
  const assigned = assignments.map(requireOk);
  assert.equal(new Set(assigned.map(row => row.id)).size, 1);
  const conflict = await workers[0].call("manual-commission", { ...manualCommand, commissionAmount: 8 });
  assert(!conflict.ok && conflict.code === "manual-commission-operation-conflict");
  snapshot = requireOk(await workers[0].call("snapshot"));
  assert.equal(snapshot.commissionRecords.filter(row => row.source === "admin_manual").length, 1);
  assert.equal(snapshot.auditLogs.filter(row => row.action === "commission_recorded" && row.newValue?.commissionId === assigned[0].id).length, 1);
  passed("Concurrent owner commission retries create one obligation and reject changed terms", { submissions: 8, obligations: 1 });

  // Stop every process after an additional synthetic trade commits, deliberately
  // omitting its after-response callback. Its durable intent must recover while
  // preserving an account restriction/password change committed afterwards.
  const recoveryRequest = { ...fixture.purchaseRequests[0], id: "audit-recovery-request", listingId: "audit-recovery-listing",
    tradeId: "audit-recovery-trade", status: "usdt_sent", usdtSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  snapshot.marketplaceListings.push({ ...fixture.marketplaceListings[0], id: recoveryRequest.listingId,
    originalAmount: "1000", availableAmount: "1000", status: "in_trade", activeTradeRequestId: recoveryRequest.id });
  snapshot.purchaseRequests.push(recoveryRequest);
  requireOk(await workers[0].call("seed", snapshot));
  requireOk(await workers[0].call("status-with-lost-follow-up", { ...sellerCommand(recoveryRequest, "completed").input,
    completionMode: "seller", usdtSentConfirmed: true }));
  snapshot = requireOk(await workers[0].call("snapshot"));
  assert(snapshot.purchaseRequests.find(row => row.id === recoveryRequest.id).trustReconciliation?.requestedAt);
  assert(!snapshot.purchaseRequests.find(row => row.id === recoveryRequest.id).trustReconciliation?.reconciledAt);
  const changedAccount = snapshot.users.find(row => row.id === "audit-buyer-14-3");
  changedAccount.disabled = true; changedAccount.passwordHash = "synthetic-new-account-password-hash";
  requireOk(await workers[0].call("seed", snapshot));
  await captureQueryMetrics("all-payment-methods-and-before-lost-follow-up-restart");
  for (const worker of workers) worker.child.kill("SIGKILL");
  workers.splice(0, workers.length, ...Array.from({ length: 4 }, (_, index) => startWorker(index + 8)));
  (await Promise.all(workers.map(worker => worker.call("ready")))).forEach(requireOk);
  const reconciled = (await Promise.all(workers.map(worker => worker.call("reconcile-trust")))).map(requireOk);
  assert.equal(reconciled.reduce((total, result) => total + result.reconciled, 0), 1);
  snapshot = requireOk(await workers[0].call("snapshot"));
  assert(snapshot.purchaseRequests.find(row => row.id === recoveryRequest.id).trustReconciliation?.reconciledAt);
  assert.equal(snapshot.commissionRecords.filter(row => row.purchaseRequestId === recoveryRequest.id).length, 1);
  assert.equal(snapshot.marketplaceListings.find(row => row.id === recoveryRequest.listingId).availableAmount, "750");
  assert.equal(snapshot.users.find(row => row.id === changedAccount.id).disabled, true);
  assert.equal(snapshot.users.find(row => row.id === changedAccount.id).passwordHash, "synthetic-new-account-password-hash");
  assert.equal(snapshot.users.find(row => row.id === recoveryRequest.sellerId).lifetimeCompletedVolumeUsdt, 1000);
  passed("Lost completion follow-up recovers after all workers restart without reverting account security or settlement", { recovered: 1, workers: 4, duplicateSettlements: 0 });

  const before = snapshot.marketplaceListings[0];
  await captureQueryMetrics("trust-recovery-before-transaction-kill");
  requireOk(await workers[0].call("hold-uncommitted-write", before.id));
  workers[0].child.kill("SIGKILL"); workers[0] = startWorker(12);
  requireOk(await workers[0].call("ready"));
  assert.equal(requireOk(await workers[0].call("manual-commission", manualCommand)).id, assigned[0].id);
  const recovered = requireOk(await workers[0].call("snapshot"));
  assert.equal(recovered.marketplaceListings.find(row => row.id === before.id).availableAmount, before.availableAmount);
  passed("Killed process rolls back its unfinished database transaction", { listing: before.id, availableAmount: before.availableAmount });
  assert(peakActiveConnections >= 2, `No overlapping PostgreSQL activity observed: ${peakActiveConnections}`);
  passed("Observed simultaneous database activity across independent processes", { peakActiveConnections });
  await captureQueryMetrics("final");
  await writeFile(path.join(output, "query-timings.json"), JSON.stringify({ scope: "Incremental query aggregates captured before each controlled process stop; no SQL text or bound values", phases: queryMetrics }, null, 2));
  await writeFile(path.join(output, "runtime.json"), JSON.stringify(runtime, null, 2));
} catch (error) {
  checks.push({ name: "Database concurrency run", status: "FAIL", error: error.stack ?? String(error) });
  console.error(error); process.exitCode = 1;
  try {
    const snapshot = requireOk(await workers[0].call("snapshot"));
    await writeFile(path.join(output, "failure-snapshot-summary.json"), JSON.stringify({
      requests: snapshot.purchaseRequests.map(({ id, status, completedAt, listingId, usdtAmount }) => ({ id, status, completedAt, listingId, usdtAmount })),
      listings: snapshot.marketplaceListings.map(({ id, availableAmount }) => ({ id, availableAmount })),
      commissions: snapshot.commissionRecords.map(({ id, purchaseRequestId, commissionAmount, paymentStatus }) => ({ id, purchaseRequestId, commissionAmount, paymentStatus })),
    }, null, 2));
  } catch (snapshotError) { console.error("Could not capture controlled failure state:", snapshotError.message); }
} finally {
  clearInterval(monitor);
  for (const worker of workers) worker.child.kill("SIGKILL");
  await pool.end();
  const durations = timings.filter(row => row.ok && row.operation === "status").map(row => row.actionElapsedMs ?? row.elapsedMs).sort((a, b) => a - b);
  const percentile = fraction => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(fraction * durations.length) - 1)] : null;
  await writeFile(path.join(output, "results.json"), JSON.stringify({ commit: process.env.GITHUB_SHA ?? null, checks, peakActiveConnections,
    serverActionTiming: { count: durations.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: percentile(1),
      scope: "Direct business-engine actions against loopback PostgreSQL, including concurrent lock waiting; excludes deferred trust persistence, browser and external delivery. Per-call elapsedMs still includes awaited background work." }, timings }, null, 2));
}
