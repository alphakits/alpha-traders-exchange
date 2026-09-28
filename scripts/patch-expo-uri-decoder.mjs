import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// Backport the maintained 0.5.0 decoder into Expo Router's legacy CommonJS
// dependency. Only the export syntax changes; its fixed algorithm is copied
// directly from the exact, integrity-locked upstream package.
const require = createRequire(import.meta.url);
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
const marker = "export default function decodeUriComponent(";
if (source.split(marker).length !== 2 || /^import\s/m.test(source)) {
  throw new Error("Unexpected upstream decoder format; refusing to apply the security backport.");
}
const patched = source.replace(marker, "module.exports = function decodeUriComponent(");
await writeFile(targetPath, `// Security backport: decode-uri-component 0.5.0 (MIT), GHSA-vcc3-ghjq-m6fr.\n${patched}`);
console.log("Applied the upstream linear-time URI decoder to Expo Router's CommonJS dependency.");
