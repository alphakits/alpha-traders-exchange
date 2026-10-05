// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const { applyDependencySecurityPatches } = await import(pathToFileURL(path.join(projectRoot, "scripts/patch-dependency-security.mjs")).href) as {
  applyDependencySecurityPatches(options: { root: string; checkOnly?: boolean }): Promise<{ packages: number; patchedFiles: number }>;
};
type GuardedDependency = {
  name: string;
  version: string;
  files: { path: string; originalSha256: string; patchedSha256: string; edits: { before: string; after: string }[] }[];
};
const manifest = JSON.parse(await readFile(path.join(projectRoot, "patches/security-dependencies.json"), "utf8")) as { packages: GuardedDependency[] };
const fixtures: string[] = [];
const hash = (source: string) => createHash("sha256").update(source).digest("hex");

async function installFixture(directory: string, dependency: GuardedDependency) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: dependency.name, version: dependency.version }));
  for (const file of dependency.files) {
    let source = await readFile(path.join(projectRoot, "node_modules", dependency.name, file.path), "utf8");
    if (hash(source) === file.patchedSha256) {
      for (const edit of [...file.edits].reverse()) source = source.replace(edit.after, () => edit.before);
    }
    expect(hash(source)).toBe(file.originalSha256);
    await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
    await writeFile(path.join(directory, file.path), source);
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "alpha-security-install-"));
  fixtures.push(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*", "packages/shared"] }));
  for (const dependency of manifest.packages) await installFixture(path.join(root, "node_modules", dependency.name), dependency);
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("dependency security installation boundary", () => {
  it("patches hoisted, scoped nested, and workspace copies and remains idempotent", async () => {
    const root = await fixture();
    const braces = manifest.packages.find((dependency) => dependency.name === "braces")!;
    const forge = manifest.packages.find((dependency) => dependency.name === "node-forge")!;
    await installFixture(path.join(root, "node_modules/@test/consumer/node_modules/braces"), braces);
    await installFixture(path.join(root, "apps/mobile/node_modules/node-forge"), forge);
    await installFixture(path.join(root, "packages/shared/node_modules/braces"), braces);
    expect(await applyDependencySecurityPatches({ root })).toEqual({ packages: 5, patchedFiles: 17 });
    expect(await applyDependencySecurityPatches({ root, checkOnly: true })).toEqual({ packages: 5, patchedFiles: 0 });
    expect(await applyDependencySecurityPatches({ root })).toEqual({ packages: 5, patchedFiles: 0 });
  });

  it("blocks a release when an installed copy is unpatched", async () => {
    const root = await fixture();
    await expect(applyDependencySecurityPatches({ root, checkOnly: true })).rejects.toThrow(/Security guard missing/);
  });

  it("requires review when the dependency version changes", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "node_modules/node-forge/package.json"), JSON.stringify({ name: "node-forge", version: "1.4.1" }));
    await expect(applyDependencySecurityPatches({ root })).rejects.toThrow(/Review the node-forge security backport for version 1.4.1/);
    const bracesFile = manifest.packages[0].files[0];
    expect(hash(await readFile(path.join(root, "node_modules/braces", bracesFile.path), "utf8"))).toBe(bracesFile.originalSha256);
  });

  it("rejects unknown source before changing any validated copy", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "node_modules/node-forge/lib/rsa.js"), "unexpected source");
    await expect(applyDependencySecurityPatches({ root })).rejects.toThrow(/source changed: node-forge\/lib\/rsa.js/);
    for (const file of manifest.packages[0].files) {
      expect(hash(await readFile(path.join(root, "node_modules/braces", file.path), "utf8"))).toBe(file.originalSha256);
    }
  });

  it("detects tampering after a successful patch", async () => {
    const root = await fixture();
    await applyDependencySecurityPatches({ root });
    const sourcePath = path.join(root, "node_modules/braces/lib/parse.js");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\n// unexpected drift\n`);
    await expect(applyDependencySecurityPatches({ root, checkOnly: true })).rejects.toThrow(/source changed: braces\/lib\/parse.js/);
  });

  it("blocks installation if a required guarded dependency is missing", async () => {
    const root = await fixture();
    await rm(path.join(root, "node_modules/node-forge"), { recursive: true });
    await expect(applyDependencySecurityPatches({ root })).rejects.toThrow(/Missing guarded dependency: node-forge/);
  });
});
