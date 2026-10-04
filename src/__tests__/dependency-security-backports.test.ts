// @vitest-environment node
import { spawnSync } from "node:child_process";
import { constants, createHash, generateKeyPairSync, privateEncrypt, sign } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Ast = { type: string; nodes?: Ast[]; value?: string; parent?: Ast };
type Braces = {
  (pattern: string): string[];
  parse: (pattern: string, options?: { maxDepth?: number }) => Ast;
  compile: (ast: Ast | string, options?: { maxDepth?: number }) => string;
  expand: (ast: Ast | string, options?: { maxDepth?: number }) => string[];
  stringify: (ast: Ast | string, options?: { maxDepth?: number; escapeInvalid?: boolean }) => string;
};
const braces = require("braces") as Braces;
const forge = require("node-forge") as {
  pki: { publicKeyFromPem: (pem: string) => { verify: (digest: string, signature: string) => boolean } };
};
const workdirs: string[] = [];
afterAll(() => workdirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("braces toolchain denial-of-service regression", () => {
  it.each(["compile", "expand", "stringify"] as const)("bounds %s of a caller-supplied AST", (method) => {
    let ast: Ast = { type: "text", value: "a" };
    for (let i = 0; i < 101; i++) ast = { type: "brace", nodes: [ast] };
    expect(() => braces[method]({ type: "root", nodes: [ast] })).toThrow(/exceeds max depth/);
  });

  it.each(["{", "("])("rejects dangerous %s patterns promptly without exhausting the stack", (open) => {
    const close = open === "{" ? "}" : ")";
    const script = `const braces = require(${JSON.stringify(require.resolve("braces"))});
      const input = ${JSON.stringify(open)}.repeat(4000) + 'a,b' + ${JSON.stringify(close)}.repeat(4000);
      for (const method of ['compile', 'expand', 'stringify']) {
        try { braces[method](input); process.exit(2); }
        catch (e) { if (!(e instanceof SyntaxError) || !/exceeds max depth/.test(e.message)) process.exit(3); }
      }`;
    const result = spawnSync(process.execPath, ["-e", script], { timeout: 3000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it("preserves common Metro and ESLint glob matching", () => {
    const match = require("micromatch") as (files: string[], pattern: string) => string[];
    expect(match(["src/a.ts", "src/b.tsx", "src/c.js", "src/private.txt"], "src/**/*.{js,ts,tsx}"))
      .toEqual(["src/a.ts", "src/b.tsx", "src/c.js"]);
    expect(braces.expand("foo/({a,b})")).toEqual(["foo/(a)", "foo/(b)"]);
  });

  it("accepts depth 100 and caps higher or fractional caller limits", () => {
    const pattern = "{".repeat(100) + "a" + "}".repeat(100);
    expect(() => braces.compile(pattern)).not.toThrow();
    expect(() => braces.parse("{" + pattern + "}", { maxDepth: 100000 })).toThrow(/exceeds max depth/);
    expect(() => braces.parse("{a,b}", { maxDepth: 1.5 })).not.toThrow();
    expect(() => braces.parse("{{a,b},c}", { maxDepth: 1.5 })).toThrow(/exceeds max depth/);
  });

  it("preserves stringify escaping of valid nested braces", () => {
    for (const pattern of ["{{a}}", "{a,{b}}", "{{x}y}", "{a,{b,{c}}", "{}{a}"])
      expect(braces.stringify(braces.parse(pattern), { escapeInvalid: true })).toBe(pattern);
  });

  it("rejects cyclic AST parents within a deadline", () => {
    const ast: Ast = { type: "paren", nodes: [{ type: "text", value: "a" }] };
    ast.parent = ast;
    expect(() => runInNewContext("expand(ast)", { expand: braces.expand, ast }, { timeout: 250 }))
      .toThrow(/parent chain contains a cycle/);
  });
});

describe("node-forge nested DigestAlgorithm regression", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 3 });
  const verifier = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  const message = Buffer.from("Alpha Traders synthetic signature compatibility");
  const digest = createHash("sha256").update(message).digest();
  const sequence = (body: Buffer) => Buffer.concat([Buffer.from([0x30, body.length]), body]);

  function signatureFor(parameters: Buffer) {
    const algorithm = sequence(Buffer.concat([Buffer.from("0609608648016503040201", "hex"), parameters]));
    const info = sequence(Buffer.concat([algorithm, Buffer.from([0x04, digest.length]), digest]));
    const encoded = Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.alloc(256 - info.length - 3, 0xff), Buffer.from([0x00]), info]);
    return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encoded).toString("binary");
  }

  it("verifies a legitimate OpenSSL signature and rejects a changed message", () => {
    const signature = sign("sha256", message, privateKey).toString("binary");
    expect(verifier.verify(digest.toString("binary"), signature)).toBe(true);
    expect(verifier.verify(createHash("sha256").update("different message").digest("binary"), signature)).toBe(false);
  });

  it.each([Buffer.alloc(0), Buffer.from([0x05, 0x00])])("accepts valid omitted or NULL digest parameters", (parameters) => {
    expect(verifier.verify(digest.toString("binary"), signatureFor(parameters))).toBe(true);
  });

  it.each([
    Buffer.from([0x05, 0x00, 0x04, 0x01, 0x42]),
    Buffer.from([0x04, 0x01, 0x42]),
    Buffer.from([0x05, 0x00, 0x05, 0x00]),
  ])("rejects extra nested elements despite valid padding and digest", (parameters) => {
    expect(() => verifier.verify(digest.toString("binary"), signatureFor(parameters)))
      .toThrow(/does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo/);
  });
});

describe("security backport installation", () => {
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "alpha-dependency-security-"));
    workdirs.push(dir);
    cpSync(resolve("scripts/patch-audit-security.mjs"), join(dir, "scripts/patch-audit-security.mjs"), { recursive: true });
    cpSync(resolve("scripts/security-backports"), join(dir, "scripts/security-backports"), { recursive: true });
    const packages: Record<string, { version: string }> = {};
    for (const name of ["braces", "node-forge"]) {
      cpSync(resolve(`node_modules/${name}`), join(dir, "node_modules", name), { recursive: true });
      packages[`node_modules/${name}`] = { version: JSON.parse(readFileSync(join(dir, "node_modules", name, "package.json"), "utf8")).version };
    }
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages }));
    return dir;
  }
  function run(dir: string) {
    return spawnSync(process.execPath, [join(dir, "scripts/patch-audit-security.mjs")], { encoding: "utf8", timeout: 3000 });
  }

  it("is idempotent on already-patched installations", () => {
    const dir = fixture();
    expect(run(dir).status).toBe(0);
    const second = run(dir);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("0 files updated");
  });

  it("rejects unexpected dependency source", () => {
    const dir = fixture();
    writeFileSync(join(dir, "node_modules/node-forge/lib/rsa.js"), "unexpected upstream source");
    const result = run(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected source hash");
  });

  it("requires review on a dependency version change", () => {
    const dir = fixture();
    writeFileSync(join(dir, "node_modules/node-forge/package.json"), JSON.stringify({ name: "node-forge", version: "1.4.1" }));
    const result = run(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Review node-forge's security backport");
  });
});
