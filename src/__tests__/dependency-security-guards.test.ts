// @vitest-environment node
import { generateKeyPairSync, createHash, privateEncrypt, sign, constants } from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const braces = require("braces");
const forge = require("node-forge");
const { SourceMapConsumer, SourceNode } = require("source-map-js");

describe("indexed source-map resource bounds", () => {
  const flatMap = { version: 3, sources: ["input.js"], sourcesContent: ["a"], names: [], mappings: "AAAA" };

  it.each([1e12, Infinity, NaN, -1, 0.5, "100"])("rejects unsafe section offset %s before reconstructing code", (line) => {
    const map = { version: 3, sections: [{ offset: { line, column: 0 }, map: flatMap }] };
    expect(() => vm.runInNewContext("SourceNode.fromStringWithSourceMap('a', new SourceMapConsumer(map))", {
      SourceNode, SourceMapConsumer, map,
    }, { timeout: 250 })).toThrow(/Section offset/);
  });

  it("bounds cumulative offsets across nested sections", () => {
    const nested = { version: 3, sections: [{ offset: { line: 6_000_000, column: 0 }, map: flatMap }] };
    expect(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 6_000_000, column: 0 }, map: nested }] })).toThrow(/including offsets of nested sections/);
  });

  it("preserves valid indexed mappings and generated code", () => {
    const consumer = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: flatMap }] });
    const rebuilt = SourceNode.fromStringWithSourceMap("a", consumer).toStringWithSourceMap({ file: "output.js" });
    expect(rebuilt.code).toBe("a");
    expect(new SourceMapConsumer(rebuilt.map.toJSON()).originalPositionFor({ line: 1, column: 0 })).toMatchObject({ source: "input.js", line: 1, column: 0 });
  });
});

function nestedAst(depth: number) {
  let ast = { type: "text", value: "a" } as { type: string; value?: string; nodes?: unknown[] };
  for (let index = 0; index < depth; index++) ast = { type: "brace", nodes: [ast] };
  return { type: "root", nodes: [ast] };
}

describe("pattern depth security guards", () => {
  it.each(["compile", "expand", "stringify", "parse"])("bounds deeply nested string inputs through %s", (method) => {
    const pattern = "{".repeat(4500) + "a,b" + "}".repeat(4500);
    expect(() => braces[method](pattern)).toThrow(/exceeds max depth/);
    expect(() => braces[method]("(".repeat(4500) + "a" + ")".repeat(4500))).toThrow(/exceeds max depth/);
  });

  it.each(["compile", "expand", "stringify"])("guards direct AST input through %s", (method) => {
    expect(() => braces[method](nestedAst(101))).toThrow(/exceeds max depth/);
    expect(() => braces[method](nestedAst(100))).not.toThrow();
    expect(() => braces[method](nestedAst(101), { maxDepth: Number.MAX_SAFE_INTEGER })).toThrow(/exceeds max depth/);
  });

  it.each(["compile", "expand", "stringify", "parse"])("honors fractional and smaller depth limits through %s", (method) => {
    expect(() => braces[method]("{a,b}", { maxDepth: 1.5 })).not.toThrow();
    expect(() => braces[method]("{{a,b},c}", { maxDepth: 1.5 })).toThrow(/exceeds max depth/);
    expect(() => braces[method]("((a))", { maxDepth: 1 })).toThrow(/exceeds max depth/);
    expect(() => braces[method]("((a))", { maxDepth: 2 })).not.toThrow();
  });

  it("preserves nested escaping, expansions, ranges, and consumer globs", () => {
    for (const pattern of ["{{a}}", "{a,{b}}", "{{x}y}", "{a,{b,{c}}", "{}{a}"]) {
      expect(braces.stringify(braces.parse(pattern), { escapeInvalid: true })).toBe(pattern);
    }
    expect(braces.expand("src/{app,components}/**/*.{ts,tsx}")).toEqual([
      "src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx",
    ]);
    expect(braces.expand("file-{01..03}.ts")).toEqual(["file-01.ts", "file-02.ts", "file-03.ts"]);
    expect(require("micromatch").match(["src/app/page.tsx", "src/lib/auth.ts", "src/app/style.css"], "src/{app,lib}/**/*.{ts,tsx}")).toEqual(["src/app/page.tsx", "src/lib/auth.ts"]);
  });

  it("bounds cyclic parent chains without hanging", () => {
    const ast: { type: string; nodes: { type: string; value: string }[]; parent?: unknown } = { type: "paren", nodes: [{ type: "text", value: "a" }] };
    ast.parent = ast;
    expect(() => vm.runInNewContext("expand(ast)", { expand: braces.expand, ast }, { timeout: 250 })).toThrow(/parent chain contains a cycle/);
    const parent = { type: "paren", parent: ast };
    ast.parent = parent;
    expect(() => vm.runInNewContext("expand(ast)", { expand: braces.expand, ast }, { timeout: 250 })).toThrow(/parent chain contains a cycle/);
  });
});

describe("RSA signature structure guards", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  const message = Buffer.from("isolated build security regression");
  const digest = createHash("sha256").update(message).digest("binary");

  function signature({ extra = false, omitNull = false, nullValue = "", extraOuter = false } = {}) {
    const asn1 = forge.asn1;
    const universal = asn1.Class.UNIVERSAL;
    const algorithm = [asn1.create(universal, asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes())];
    if (!omitNull) algorithm.push(asn1.create(universal, asn1.Type.NULL, false, nullValue));
    if (extra) algorithm.push(asn1.create(universal, asn1.Type.OCTETSTRING, false, "unconsumed garbage"));
    const value = [asn1.create(universal, asn1.Type.SEQUENCE, true, algorithm), asn1.create(universal, asn1.Type.OCTETSTRING, false, digest)];
    if (extraOuter) value.push(asn1.create(universal, asn1.Type.OCTETSTRING, false, "extra outer element"));
    const der = asn1.toDer(asn1.create(universal, asn1.Type.SEQUENCE, true, value)).getBytes();
    return privateEncrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(der, "binary")).toString("binary");
  }

  it("accepts valid OpenSSL signatures and permitted absent NULL parameters", () => {
    expect(publicKey.verify(digest, sign("sha256", message, keys.privateKey).toString("binary"))).toBe(true);
    expect(publicKey.verify(digest, signature())).toBe(true);
    expect(publicKey.verify(digest, signature({ omitNull: true }))).toBe(true);
    expect(publicKey.verify(createHash("sha256").update("different message").digest("binary"), signature())).toBe(false);
  });

  it.each([
    ["extra nested element", { extra: true }],
    ["extra element without NULL", { extra: true, omitNull: true }],
    ["nonempty NULL padding", { nullValue: "garbage" }],
    ["extra outer element", { extraOuter: true }],
  ] as const)("rejects %s in a mathematically signed malformed structure", (_, options) => {
    expect(() => publicKey.verify(digest, signature(options))).toThrow(/valid RSASSA-PKCS1-v1_5/);
  });
});
