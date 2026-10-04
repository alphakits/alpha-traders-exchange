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
// Original upstream v0.2.2 source, retained with its MIT notice beside it.
const legacySource = await readFile(path.join(projectRoot, "src/__tests__/fixtures/decode-uri-component-0.2.2.txt"), "utf8");
const patchedSource = `// Security backport: decode-uri-component 0.5.0 (MIT), GHSA-vcc3-ghjq-m6fr.\n${fixedSource.replace("export default function decodeUriComponent(", "module.exports = function decodeUriComponent(")}`;
const fixtureRoots: string[] = [];
const legacyDirectory = "node_modules/query-string/node_modules/decode-uri-component";

async function decoder(root: string, directory: string, version = "0.2.2", source = legacySource) {
  const target = path.join(root, directory);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "package.json"), JSON.stringify({ name: "decode-uri-component", version, main: "index.js", type: version === "0.5.0" ? "module" : "commonjs" }));
  await writeFile(path.join(target, "index.js"), source);
  return path.join(target, "index.js");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "alpha-uri-install-"));
  fixtureRoots.push(root);
  await mkdir(path.join(root, "scripts"));
  for (const script of ["patch-expo-uri-decoder.mjs", "installed-package-copies.mjs"]) {
    await writeFile(path.join(root, "scripts", script), await readFile(path.join(projectRoot, "scripts", script), "utf8"));
  }
  await writeFile(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*", "packages/shared"] }));
  await decoder(root, "node_modules/decode-uri-component", "0.5.0", fixedSource);
  await decoder(root, legacyDirectory);
  for (const name of ["expo-router", "query-string"]) {
    const directory = path.join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }));
    await writeFile(path.join(directory, "index.js"), "module.exports = {};\n");
  }
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
  it("rejects an unpatched release without changing installed files", async () => {
    const root = await fixture();
    const result = run(root, "--check");
    expect(result.status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });

  it("patches scoped nested and both workspace copies and verifies them without writes", async () => {
    const root = await fixture();
    const directories = [legacyDirectory, "node_modules/@test/consumer/node_modules/decode-uri-component", "apps/mobile/node_modules/decode-uri-component", "packages/shared/node_modules/decode-uri-component"];
    for (const directory of directories.slice(1)) await decoder(root, directory);
    const applied = run(root);
    expect(applied.status, applied.stderr).toBe(0);
    for (const directory of directories) expect(await readFile(path.join(root, directory, "index.js"), "utf8")).toBe(patchedSource);
    expect(applied.stdout).toContain("5 dependency copies (4 files patched)");
    const checked = run(root, "--check");
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain("0 files patched");
    expect(run(root).stdout).toContain("0 files patched");
  });

  it("rejects a changed workspace copy after an otherwise successful installation", async () => {
    const root = await fixture();
    const file = await decoder(root, "apps/mobile/node_modules/decode-uri-component");
    expect(run(root).status).toBe(0);
    const drifted = `${await readFile(file, "utf8")}\n// unexpected drift\n`;
    await writeFile(file, drifted);
    expect(run(root, "--check").status).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe(drifted);
  });

  it("rejects changed upstream source before modifying a legacy decoder", async () => {
    const root = await fixture();
    await decoder(root, "node_modules/decode-uri-component", "0.5.0", `${fixedSource}\n// unexpected drift\n`);
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });

  it("rejects an unsupported nested version before patching any copy", async () => {
    const root = await fixture();
    await decoder(root, "node_modules/@test/consumer/node_modules/decode-uri-component", "0.2.3");
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });

  it("rejects an unknown legacy source before modifying any other copy", async () => {
    const root = await fixture();
    await decoder(root, "packages/shared/node_modules/decode-uri-component", "0.2.2", "module.exports = () => 'unknown source';\n");
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });

  it("requires review when Expo's resolved legacy dependency changes", async () => {
    const root = await fixture();
    await decoder(root, legacyDirectory, "0.5.0", fixedSource);
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pinned dependency versions");
  });

  it("rejects unknown options without applying the backport", async () => {
    const root = await fixture();
    expect(run(root, "--unknown").status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });

  it("validates fixed decoder copies inside workspaces before any legacy writes", async () => {
    const root = await fixture();
    await decoder(root, "apps/mobile/node_modules/decode-uri-component", "0.5.0", `${fixedSource}\n// unexpected drift\n`);
    expect(run(root).status).not.toBe(0);
    expect(await readFile(path.join(root, legacyDirectory, "index.js"), "utf8")).toBe(legacySource);
  });
});
