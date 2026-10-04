import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageCopies } from "./installed-package-copies.mjs";

// Backport the maintained 0.5.0 decoder into Expo Router's legacy CommonJS
// dependency. Only the export syntax changes; its fixed algorithm is copied
// directly from the exact, integrity-locked upstream package.
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// Exact upstream v0.5.0 / v0.2.2 release sources. The output is unchanged
// from the existing CommonJS backport; versions and licenses stay intact.
const SOURCE_SHA256 = "9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa";
const LEGACY_SHA256 = "3b8ba0a765e1089d11bba9a919d0d8789ecd9a6833ea078d8d9114e1db093863";
const PATCHED_SHA256 = "f2a467cde7cf3a27d1af4ea367f5edf79ec1e45ee1ee8fa54cd71bc5642abc94";
const marker = "export default function decodeUriComponent(";

export async function applyExpoUriDecoderPatch({ root = projectRoot, checkOnly = false } = {}) {
  const require = createRequire(path.join(root, "package.json"));
  const sourcePath = require.resolve("decode-uri-component");
  const expoRequire = createRequire(require.resolve("expo-router/package.json"));
  const queryRequire = createRequire(expoRequire.resolve("query-string"));
  const targetPath = queryRequire.resolve("decode-uri-component");
  const manifestAt = async (entry) => JSON.parse(await readFile(path.join(path.dirname(entry), "package.json"), "utf8"));
  const sourceManifest = await manifestAt(sourcePath);
  const targetManifest = await manifestAt(targetPath);
  if (sourceManifest.version !== "0.5.0" || targetManifest.version !== "0.2.2" || sourcePath === targetPath) {
    throw new Error("Review the Expo URI-decoder backport before changing the pinned dependency versions.");
  }
  const source = await readFile(sourcePath, "utf8");
  if (sha256(source) !== SOURCE_SHA256 || source.split(marker).length !== 2 || /^import\s/m.test(source)) {
    throw new Error("Upstream URI-decoder source changed; refusing to apply the security backport.");
  }
  const patched = `// Security backport: decode-uri-component 0.5.0 (MIT), GHSA-vcc3-ghjq-m6fr.\n${source.replace(marker, "module.exports = function decodeUriComponent(")}`;
  if (sha256(patched) !== PATCHED_SHA256) throw new Error("URI-decoder backport checksum mismatch.");

  const packages = await installedPackageCopies(root, new Set(["decode-uri-component"]));
  // Include the actual consumers even if their entry point was reached via
  // a workspace symlink rather than a physical package directory.
  packages.set(path.dirname(sourcePath), "decode-uri-component");
  packages.set(path.dirname(targetPath), "decode-uri-component");
  const writes = [];
  let legacyCopies = 0;
  for (const directory of packages.keys()) {
    const installed = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const file = path.join(directory, "index.js");
    const hash = sha256(await readFile(file, "utf8"));
    if (installed.name !== "decode-uri-component") throw new Error("Unexpected URI-decoder package identity.");
    if (installed.version === "0.5.0") {
      if (hash !== SOURCE_SHA256) throw new Error("Upstream URI-decoder source changed.");
      continue;
    }
    if (installed.version !== "0.2.2") {
      throw new Error(`Review the URI-decoder security backport for version ${installed.version}.`);
    }
    legacyCopies++;
    if (hash === PATCHED_SHA256) continue;
    if (checkOnly || hash !== LEGACY_SHA256) throw new Error("URI-decoder guard missing or source changed.");
    writes.push({ file, patched });
  }
  // Validate every fixed and legacy copy before changing any file.
  for (const { file, patched: output } of writes) await writeFile(file, output);
  return { packages: packages.size, legacyCopies, patchedFiles: writes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--check")) throw new Error("Unknown URI-decoder security option.");
  const result = await applyExpoUriDecoderPatch({ checkOnly: args.includes("--check") });
  console.log(`Verified URI decoder in ${result.packages} dependency copies (${result.patchedFiles} files patched).`);
}
