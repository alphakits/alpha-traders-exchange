import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function directoryEntries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function installedPackageCopies(root, names) {
  const found = new Map();
  async function scan(nodeModules) {
    async function inspect(directory, name) {
      if (names.has(name)) found.set(directory, name);
      await scan(path.join(directory, "node_modules"));
    }
    for (const entry of await directoryEntries(nodeModules)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const directory = path.join(nodeModules, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await directoryEntries(directory)) {
          if (scoped.isDirectory()) await inspect(path.join(directory, scoped.name), `${entry.name}/${scoped.name}`);
        }
      } else await inspect(directory, entry.name);
    }
  }
  await scan(path.join(root, "node_modules"));
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const workspace of manifest.workspaces ?? []) {
    const parent = workspace.endsWith("/*") ? workspace.slice(0, -2) : null;
    const directories = parent
      ? (await directoryEntries(path.join(root, parent))).filter((entry) => entry.isDirectory()).map((entry) => path.join(root, parent, entry.name))
      : [path.join(root, workspace)];
    for (const directory of directories) await scan(path.join(directory, "node_modules"));
  }
  return found;
}
