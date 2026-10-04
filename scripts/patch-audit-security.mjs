import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reviewed backports of the pinned upstream proposals documented alongside
// patches.json. Package versions remain truthful; npm audit still reports them.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patches = JSON.parse(await readFile(new URL("./security-backports/patches.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const writes = [];

// Validate the whole plan before writing any dependency. A new release or
// unexpected source change must receive review instead of a guessed patch.
for (const patch of patches) {
  const suffix = `node_modules/${patch.package}`;
  const installations = Object.entries(lock.packages).filter(([entry]) => entry === suffix || entry.endsWith(`/${suffix}`));
  if (!installations.length) throw new Error(`Missing locked security-backport dependency: ${patch.package}`);
  for (const [entry, locked] of installations) {
    const packageRoot = path.join(root, entry);
    const installed = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (locked.version !== patch.version || installed.version !== patch.version) {
      throw new Error(`Review ${patch.package}'s security backport before changing version ${patch.version}.`);
    }
    const target = path.join(packageRoot, patch.file);
    const original = await readFile(target, "utf8");
    if (sha256(original) === patch.patchedSha256) continue;
    if (sha256(original) !== patch.originalSha256) {
      throw new Error(`Unexpected source hash for ${entry}/${patch.file}; refusing the security backport.`);
    }
    let patched = original;
    for (const { before, after } of patch.hunks) {
      if (patched.split(before).length !== 2) throw new Error(`Unexpected patch context: ${entry}/${patch.file}`);
      // A callback preserves literal $ characters in upstream source.
      patched = patched.replace(before, () => after);
    }
    if (sha256(patched) !== patch.patchedSha256) throw new Error(`Unexpected patched hash: ${entry}/${patch.file}`);
    writes.push({ target, patched });
  }
}
for (const { target, patched } of writes) await writeFile(target, patched);
console.log(`Verified pinned braces/node-forge security backports (${writes.length} files updated).`);
