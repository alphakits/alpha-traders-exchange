import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Temporary verification-branch tooling. npm generates the real lockfile;
// the unchanged release gate still decides whether this candidate passes.
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const beforeText = readFileSync("package-lock.json", "utf8");
const before = JSON.parse(beforeText);
const hash = (text) => createHash("sha256").update(text).digest("hex");

function run(args) {
  const result = spawnSync(npmExecutable, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });
  if (result.error) {
    console.error("Dependency preparation could not start:", result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("Dependency preparation failed:", result.status ?? result.signal);
    process.exit(result.status ?? 1);
  }
}

console.log("Verification build Node version:", process.version);
run(["--version"]);
run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);

const afterText = readFileSync("package-lock.json", "utf8");
const after = JSON.parse(afterText);
const changes = {};
for (const key of new Set([...Object.keys(before.packages), ...Object.keys(after.packages)])) {
  if (JSON.stringify(before.packages[key]) !== JSON.stringify(after.packages[key])) {
    changes[key] = after.packages[key] ?? null;
  }
}
const { packages, ...metadata } = after;
console.log("\n===== NPM GENERATED LOCKFILE DELTA: COPY THIS REPORT =====");
console.log(JSON.stringify({
  baseSha256: hash(beforeText),
  generatedSha256: hash(afterText),
  metadata,
  packages: changes,
}, null, 2));
console.log("===== END NPM GENERATED LOCKFILE DELTA =====\n");
console.log("Generated lockfile entries:", Object.keys(packages).length);
console.log("Changed lockfile entries:", Object.keys(changes).length);

// A clean install verifies the regenerated graph and runs the project's normal
// postinstall. No install-script policy is disabled or broadened here.
run(["ci", "--no-audit", "--no-fund"]);

const parcelDirectory = path.join("node_modules", "@parcel", "watcher");
console.log("\n===== PARCEL INSTALL SCRIPT REVIEW =====");
for (const filename of ["package.json", "binding.gyp", "scripts/build-from-source.js"]) {
  const filenamePath = path.join(parcelDirectory, filename);
  if (!existsSync(filenamePath)) continue;
  const source = readFileSync(filenamePath, "utf8");
  if (filename === "package.json") {
    const manifest = JSON.parse(source);
    console.log(JSON.stringify({
      filename,
      name: manifest.name,
      version: manifest.version,
      scripts: manifest.scripts,
      sha256: hash(source),
    }, null, 2));
  } else {
    console.log(JSON.stringify({ filename, sha256: hash(source), source }, null, 2));
  }
}
console.log("===== END PARCEL INSTALL SCRIPT REVIEW =====\n");
