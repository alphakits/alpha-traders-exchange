import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPackageCopies } from "./installed-package-copies.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "patches/security-dependencies.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function applyDependencySecurityPatches({ root = projectRoot, checkOnly = false } = {}) {
  const targets = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const copies = await installedPackageCopies(root, new Set(targets.keys()));
  const packages = new Map([...copies].map(([directory, name]) => [directory, targets.get(name)]));
  const missing = [...targets.keys()].filter((name) => ![...packages.values()].some((entry) => entry.name === name));
  if (missing.length) throw new Error(`Missing guarded dependency: ${missing.join(", ")}`);

  // Validate every copy and every transformation before changing any file.
  // A changed upstream version or unexpected source blocks installation/release.
  const writes = [];
  for (const [directory, dependency] of packages) {
    const installed = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (installed.version !== dependency.version) {
      throw new Error(`Review the ${dependency.name} security backport for version ${installed.version}.`);
    }
    for (const patch of dependency.files) {
      const file = path.join(directory, patch.path);
      const source = await readFile(file, "utf8");
      const currentHash = sha256(source);
      if (currentHash === patch.patchedSha256) continue;
      if (checkOnly || currentHash !== patch.originalSha256) {
        throw new Error(`Security guard missing or source changed: ${dependency.name}/${patch.path}`);
      }
      let patched = source;
      for (const edit of patch.edits) {
        if (!edit.before || patched.split(edit.before).length !== 2) {
          throw new Error(`Unexpected backport context: ${dependency.name}/${patch.path}`);
        }
        patched = patched.replace(edit.before, () => edit.after);
      }
      if (sha256(patched) !== patch.patchedSha256) {
        throw new Error(`Backport checksum mismatch: ${dependency.name}/${patch.path}`);
      }
      writes.push({ file, patched });
    }
  }
  for (const { file, patched } of writes) await writeFile(file, patched);
  return { packages: packages.size, patchedFiles: writes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--check")) throw new Error("Unknown dependency security option.");
  const result = await applyDependencySecurityPatches({ checkOnly: args.includes("--check") });
  console.log(`Verified depth and RSA signature guards in ${result.packages} dependency copies (${result.patchedFiles} files patched).`);
}
