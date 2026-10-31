import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageCopies } from "./installed-package-copies.mjs";

// Use the maintained 0.5.1 decoder everywhere. Its single-pass replacement
// fixes GHSA-qr28-fpjm-wq7f as well as the earlier GHSA-vcc3-ghjq-m6fr.
// Expo Router still consumes query-string 7.1.3 through CommonJS; adapt only
// that consumer's default import, preserving the upstream decoder and APIs.
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// Exact published decode-uri-component v0.5.1 and query-string v7.1.3 sources.
const SOURCE_SHA256 = "6a86ac891edf15c5efa0841ebb31935e3669d58b98318b57d7b08a4530317cb0";
const QUERY_SHA256 = "caa3f2c8b45dfe1e91db22ae10743af68de8d96f26515132bb52485ec0f037fa";
const PATCHED_SHA256 = "fc1ca6e1961ba005e554b1bc0de932d6454bf59bfaea03d02c7261dbdcafcdbd";
const originalImport = "const decodeComponent = require('decode-uri-component');";
const fixedImport = "const decodeComponent = require('decode-uri-component').default;";

export async function applyExpoUriDecoderPatch({ root = projectRoot, checkOnly = false } = {}) {
  const require = createRequire(path.join(root, "package.json"));
  const sourcePath = require.resolve("decode-uri-component");
  const expoRequire = createRequire(require.resolve("expo-router/package.json"));
  const queryPath = expoRequire.resolve("query-string");
  const packages = await installedPackageCopies(root, new Set(["decode-uri-component", "query-string"]));
  // Include actual consumers reached through workspace symlinks, and check
  // each query-string copy's resolved decoder before changing any source.
  packages.set(path.dirname(sourcePath), "decode-uri-component");
  packages.set(path.dirname(queryPath), "query-string");
  for (const [directory, name] of packages) {
    if (name !== "query-string") continue;
    const consumerRequire = createRequire(path.join(directory, "package.json"));
    packages.set(path.dirname(consumerRequire.resolve("decode-uri-component")), "decode-uri-component");
  }
  const writes = [];
  for (const [directory, name] of packages) {
    const installed = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (installed.name !== name) throw new Error("Unexpected URI-decoder dependency identity.");
    const file = path.join(directory, "index.js");
    const source = await readFile(file, "utf8");
    const hash = sha256(source);
    if (name === "decode-uri-component") {
      if (installed.version !== "0.5.1") {
        throw new Error(`Review the URI-decoder security fix for version ${installed.version}.`);
      }
      if (hash !== SOURCE_SHA256) throw new Error("Upstream URI-decoder source changed.");
      continue;
    }
    if (installed.version !== "7.1.3") {
      throw new Error(`Review the query-string URI-decoder adapter for version ${installed.version}.`);
    }
    if (hash === PATCHED_SHA256) continue;
    if (checkOnly || hash !== QUERY_SHA256) throw new Error("URI-decoder adapter missing or query-string source changed.");
    if (source.split(originalImport).length !== 2) throw new Error("Unexpected query-string URI-decoder import.");
    const patched = source.replace(originalImport, fixedImport);
    if (sha256(patched) !== PATCHED_SHA256) throw new Error("URI-decoder adapter checksum mismatch.");
    writes.push({ file, patched });
  }
  // Validate every fixed decoder and adapter before changing any file.
  for (const { file, patched: output } of writes) await writeFile(file, output);
  return { packages: packages.size, patchedFiles: writes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--check")) throw new Error("Unknown URI-decoder security option.");
  const result = await applyExpoUriDecoderPatch({ checkOnly: args.includes("--check") });
  console.log(`Verified fixed URI decoder and CommonJS adapter in ${result.packages} dependency copies (${result.patchedFiles} files patched).`);
}
