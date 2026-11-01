// @vitest-environment node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const require = createRequire(import.meta.url);
const fixedSource = await readFile(require.resolve("decode-uri-component"), "utf8");
const originalImport = "const decodeComponent = require('decode-uri-component');";
const fixedImport = "const decodeComponent = require('decode-uri-component').default;";
const querySource = (await readFile(require.resolve("query-string"), "utf8")).replace(fixedImport, originalImport);
const patchedSource = querySource.replace(originalImport, fixedImport);
const fixtureRoots: string[] = [];
const queryDirectory = "node_modules/query-string";

async function dependency(root: string, directory: string, name: string, version: string, source: string) {
  const target = path.join(root, directory);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "package.json"), JSON.stringify({ name, version, main: "index.js", type: name === "decode-uri-component" ? "module" : "commonjs" }));
  await writeFile(path.join(target, "index.js"), source);
  return path.join(target, "index.js");
}

async function decoder(root: string, directory: string, version = "0.5.1", source = fixedSource) {
  return dependency(root, directory, "decode-uri-component", version, source);
}

async function query(root: string, directory: string, version = "7.1.3", source = querySource) {
  return dependency(root, directory, "query-string", version, source);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "alpha-uri-install-"));
  fixtureRoots.push(root);
  await mkdir(path.join(root, "scripts"));
  for (const script of ["patch-expo-uri-decoder.mjs", "installed-package-copies.mjs"]) {
    await writeFile(path.join(root, "scripts", script), await readFile(path.join(projectRoot, "scripts", script), "utf8"));
  }
  await writeFile(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*", "packages/shared"] }));
  await decoder(root, "node_modules/decode-uri-component");
  await query(root, queryDirectory);
  await dependency(root, "node_modules/expo-router", "expo-router", "57.0.29", "module.exports = {};\n");
  return root;
}

function run(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/patch-expo-uri-decoder.mjs"), ...args], { encoding: "utf8", timeout: 10_000 });
  expect(result.error).toBeUndefined();
  return result;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Expo URI decoder installation boundary", () => {
  it("rejects a missing adapter without changing installed files", async () => {
    const root = await fixture();
    const result = run(root, "--check");
    expect(result.status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });

  it("adapts scoped nested and workspace consumers without modifying fixed decoder copies", async () => {
    const root = await fixture();
    const directories = [queryDirectory, "node_modules/@test/consumer/node_modules/query-string", "apps/mobile/node_modules/query-string", "packages/shared/node_modules/query-string"];
    for (const directory of directories.slice(1)) await query(root, directory);
    const fixedDirectories = ["node_modules/decode-uri-component", "node_modules/query-string/node_modules/decode-uri-component", "apps/mobile/node_modules/decode-uri-component"];
    for (const directory of fixedDirectories.slice(1)) await decoder(root, directory);
    const applied = run(root);
    expect(applied.status, applied.stderr).toBe(0);
    for (const directory of directories) expect(await readFile(path.join(root, directory, "index.js"), "utf8")).toBe(patchedSource);
    for (const directory of fixedDirectories) expect(await readFile(path.join(root, directory, "index.js"), "utf8")).toBe(fixedSource);
    expect(applied.stdout).toContain("7 dependency copies (4 files patched)");
    const checked = run(root, "--check");
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain("0 files patched");
    expect(run(root).stdout).toContain("0 files patched");
  });

  it("rejects a changed workspace adapter after an otherwise successful installation", async () => {
    const root = await fixture();
    const file = await query(root, "apps/mobile/node_modules/query-string");
    expect(run(root).status).toBe(0);
    const drifted = `${await readFile(file, "utf8")}\n// unexpected drift\n`;
    await writeFile(file, drifted);
    expect(run(root, "--check").status).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe(drifted);
  });

  it("rejects changed upstream decoder source before modifying a consumer", async () => {
    const root = await fixture();
    await decoder(root, "node_modules/decode-uri-component", "0.5.1", `${fixedSource}\n// unexpected drift\n`);
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });

  it.each(["0.2.2", "0.5.0", "0.5.2"])("rejects unreviewed nested decoder %s before adapting any consumer", async (version) => {
    const root = await fixture();
    await decoder(root, "node_modules/@test/consumer/node_modules/decode-uri-component", version);
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });

  it("rejects an unknown consumer source before modifying any other copy", async () => {
    const root = await fixture();
    await query(root, "packages/shared/node_modules/query-string", "7.1.3", "module.exports = {};\n");
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });

  it("requires review when Expo's resolved consumer version changes", async () => {
    const root = await fixture();
    await query(root, queryDirectory, "7.1.4");
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("adapter for version 7.1.4");
  });

  it("rejects unknown options without applying the adapter", async () => {
    const root = await fixture();
    expect(run(root, "--unknown").status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });

  it("validates fixed decoder copies inside workspaces before any adapter writes", async () => {
    const root = await fixture();
    await decoder(root, "apps/mobile/node_modules/decode-uri-component", "0.5.1", `${fixedSource}\n// unexpected drift\n`);
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, queryDirectory, "index.js"), "utf8")).toBe(querySource);
  });
});
