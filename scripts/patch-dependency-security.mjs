import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "patches/security-dependencies.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function installedPackages(nodeModules, targets, found = new Map()) {
  const inspect = async (directory, name) => {
    if (targets.has(name)) found.set(directory, targets.get(name));
    await installedPackages(path.join(directory, "node_modules"), targets, found);
  };
  for (const entry of await directoryEntries(nodeModules)) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of await directoryEntries(directory)) {
        if (scoped.isDirectory()) await inspect(path.join(directory, scoped.name), `${entry.name}/${scoped.name}`);
      }
    } else {
      await inspect(directory, entry.name);
    }
  }
  return found;
}

export async function applyDependencySecurityPatches({ root = projectRoot, checkOnly = false } = {}) {
  const targets = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const packages = await installedPackages(path.join(root, "node_modules"), targets);
  const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const workspace of packageManifest.workspaces ?? []) {
    const parent = workspace.endsWith("/*") ? workspace.slice(0, -2) : null;
    const directories = parent
      ? (await directoryEntries(path.join(root, parent))).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, parent, entry.name))
      : [path.join(root, workspace)];
    for (const directory of directories) await installedPackages(path.join(directory, "node_modules"), targets, packages);
  }
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
