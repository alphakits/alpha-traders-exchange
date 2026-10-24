import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { getNpmCommand } from "./npm-command.mjs";

test("Windows invokes the npm script directly with literal paths and arguments", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "npm command & spaces-"));
  try {
    const cli = path.join(directory, "npm-cli.js");
    writeFileSync(cli, "console.log(JSON.stringify(process.argv.slice(2)))");
    const npm = getNpmCommand({ platform: "win32", env: { npm_execpath: cli } });
    assert.equal(npm.command, process.execPath);
    const argumentsToPreserve = ["audit", "--json", "literal & value", "$(do-not-run)"];
    const result = spawnSync(npm.command, [...npm.prefixArgs, ...argumentsToPreserve], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), argumentsToPreserve);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Windows falls back to the Node installation and fails closed when npm is absent", () => {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  assert.deepEqual(getNpmCommand({ platform: "win32", env: { npm_execpath: "relative/npm-cli.js" }, exists: p => p === cli }),
    { command: process.execPath, prefixArgs: [cli] });
  assert.throws(() => getNpmCommand({ platform: "win32", env: {}, exists: () => false }), /npm CLI could not be located/);
});

test("POSIX keeps PATH-based npm resolution without a shell", () => {
  assert.deepEqual(getNpmCommand({ platform: "linux", env: {} }), { command: "npm", prefixArgs: [] });
});
