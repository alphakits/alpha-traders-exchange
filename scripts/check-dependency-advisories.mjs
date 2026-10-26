import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNpmCommand } from "./npm-command.mjs";

// These exact upstream advisories have source-verified local backports.
// Do not broaden this list to silence a new advisory or severity change.
const guardedAdvisories = new Map([
  ["https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", { name: "braces", severity: "high" }],
  ["https://github.com/advisories/GHSA-86w9-cpqp-85rv", { name: "node-forge", severity: "high" }],
  ["https://github.com/advisories/GHSA-vcc3-ghjq-m6fr", { name: "decode-uri-component", severity: "moderate" }],
]);
const severities = ["info", "low", "moderate", "high", "critical"];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function assessDependencyAudit(report, { backportsVerified = false } = {}) {
  if (!isObject(report) || report.error || report.auditReportVersion !== 2 ||
      !isObject(report.vulnerabilities) || !isObject(report.metadata?.vulnerabilities)) {
    throw new Error("Dependency audit did not return a complete version-2 report.");
  }
  const vulnerabilities = report.vulnerabilities;
  const totals = report.metadata.vulnerabilities;
  for (const severity of severities) {
    const actual = Object.values(vulnerabilities).filter(v => v?.severity === severity).length;
    if (!Number.isInteger(totals[severity]) || totals[severity] !== actual) {
      throw new Error(`Dependency audit has inconsistent ${severity} totals.`);
    }
  }
  if (totals.total !== Object.keys(vulnerabilities).length) {
    throw new Error("Dependency audit has an inconsistent total.");
  }
  const blockers = new Set();
  const guarded = new Set();
  const moderate = [];
  const rootsFor = (name, visited = new Set()) => {
    if (visited.has(name)) return [];
    const entry = vulnerabilities[name];
    if (!isObject(entry) || !severities.includes(entry.severity) || !Array.isArray(entry.via) || entry.via.length === 0) {
      throw new Error(`Dependency audit is missing advisory details for ${name}.`);
    }
    const next = new Set(visited).add(name);
    return entry.via.flatMap(via => {
      if (typeof via === "string") return rootsFor(via, next);
      if (!isObject(via) || typeof via.name !== "string" || typeof via.url !== "string" || !severities.includes(via.severity)) {
        throw new Error(`Dependency audit contains malformed advisory details for ${name}.`);
      }
      return [via];
    });
  };
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!severities.includes(entry?.severity)) throw new Error(`Unknown advisory severity for ${name}.`);
    if (entry.severity === "moderate") moderate.push(name);
    if (!["moderate", "high", "critical"].includes(entry.severity)) continue;
    const roots = rootsFor(name);
    if (roots.length === 0) throw new Error(`Dependency audit cannot resolve the advisory chain for ${name}.`);
    for (const advisory of roots) {
      const expected = guardedAdvisories.get(advisory.url);
      if (backportsVerified && expected?.name === advisory.name
          && expected.severity === advisory.severity && entry.severity === expected.severity) {
        guarded.add(`${advisory.name}: ${advisory.url}`);
      } else {
        blockers.add(`${name}: ${advisory.name} ${advisory.severity} ${advisory.url}`);
      }
    }
  }
  return { blockers: [...blockers], guarded: [...guarded], moderate, totals };
}

// npm's default request timeout exceeds the entire release budget. Bound each
// request and each fresh process so a stalled registry connection can recover.
// Retrying never changes the report/allowlist policy and never uses an old report.
const auditBudgetMs = 90_000;
const auditAttemptMs = 30_000;
const maxAuditAttempts = 3;
const transientNetworkCodes = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"]);

function transientAuditFailure(report) {
  // npm audit drops some transport error codes, but retains its timeout message.
  // Never classify a partial/complete advisory report as a transport-only error.
  if (!isObject(report) || !isObject(report.error) ||
      "auditReportVersion" in report || "vulnerabilities" in report || "metadata" in report) return null;
  const code = report.error.code ?? report.code;
  if (transientNetworkCodes.has(code)) return code;
  if ([429, 502, 503, 504].includes(report.statusCode)) return `HTTP_${report.statusCode}`;
  if (typeof report.message === "string" && /^network timeout at: https?:\/\/\S+$/.test(report.message)) return "REQUEST_TIMEOUT";
  return null;
}

export function readFreshDependencyAudit({ cwd } = {}) {
  const npm = getNpmCommand();
  const deadline = performance.now() + auditBudgetMs;
  let lastReason = "DEADLINE_EXCEEDED";
  for (let attempt = 1; attempt <= maxAuditAttempts; attempt++) {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) break;
    const result = spawnSync(npm.command,
      [...npm.prefixArgs, "audit", "--omit=dev", "--json", "--fetch-timeout=10000", "--fetch-retries=0"], {
        cwd,
        encoding: "utf8", timeout: Math.min(auditAttemptMs, remainingMs),
        killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
      });
    if (result.error) {
      if (result.error.code !== "ETIMEDOUT" || result.stdout?.trim()) {
        throw new Error("Fresh dependency audit process failed; release remains blocked.");
      }
      lastReason = "PROCESS_TIMEOUT";
    } else {
      if (![0, 1].includes(result.status)) {
        throw new Error("Fresh dependency audit unavailable; release remains blocked.");
      }
      let report;
      try { report = JSON.parse(result.stdout); }
      catch { throw new Error("Fresh dependency audit returned malformed JSON; release remains blocked."); }
      const transient = result.status === 1 ? transientAuditFailure(report) : null;
      if (!transient) return report;
      lastReason = transient;
    }
    if (attempt < maxAuditAttempts && performance.now() < deadline) {
      // Only fixed classifications are logged: npm diagnostics can contain URLs,
      // registry credentials or response bodies.
      console.warn(`Fresh dependency audit attempt ${attempt}/${maxAuditAttempts} failed (${lastReason}); retrying within the 90s budget.`);
    }
  }
  throw new Error(`Fresh dependency audit unavailable (${lastReason}); release remains blocked.`);
}

export function runDependencyAudit() {
  // A known advisory is accepted only after every installed copy passes the
  // reviewed source hashes, versions and patch-integrity checks.
  for (const script of ["scripts/patch-expo-uri-decoder.mjs", "scripts/patch-dependency-security.mjs"]) {
    const check = spawnSync(process.execPath, [script, "--check"], { stdio: "inherit", timeout: 30_000 });
    if (check.error || check.status !== 0) throw new Error(`Security backport integrity failed: ${script}`);
  }
  const report = readFreshDependencyAudit();
  const assessment = assessDependencyAudit(report, { backportsVerified: true });
  console.log(JSON.stringify(assessment, null, 2));
  if (assessment.blockers.length) throw new Error("Unreviewed moderate/high/critical dependency advisories block release.");
  console.log("Dependency advisory gate passed. Guarded and moderate findings remain explicitly reported; this is not a clean npm audit.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { runDependencyAudit(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
