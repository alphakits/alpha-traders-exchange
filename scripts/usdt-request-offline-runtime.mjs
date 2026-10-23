import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const samePath = (left, right) => process.platform === "win32"
  ? left.toLowerCase() === right.toLowerCase() : left === right;

// Resume only an existing, direct runtime child. Resolve both lexical and real
// paths so traversal, junctions, links and aliases cannot select other data.
export async function resolveExistingOfflineRuntime(runtimeParent, selectedPath) {
  if (!selectedPath || selectedPath.startsWith("--")) throw new Error("Provide the existing run-* folder after --resume-runtime.");
  const parent = path.resolve(runtimeParent);
  const selected = path.resolve(selectedPath);
  if (!samePath(path.dirname(selected), parent) || !/^run-[A-Za-z0-9_-]+$/.test(path.basename(selected))) {
    throw new Error("Resume must use an existing immediate run-* child of usdt-offline-runtime.");
  }
  const parentInfo = await lstat(parent);
  const selectedInfo = await lstat(selected);
  if (!parentInfo.isDirectory() || !selectedInfo.isDirectory() || parentInfo.isSymbolicLink() || selectedInfo.isSymbolicLink()) {
    throw new Error("Offline runtime folders must be real directories, not links or junctions.");
  }
  const realParent = await realpath(parent);
  const realSelected = await realpath(selected);
  if (!samePath(realParent, parent) || !samePath(realSelected, selected) || !samePath(path.dirname(realSelected), realParent)) {
    throw new Error("Offline runtime paths must not traverse links, junctions or alternate locations.");
  }
  return realSelected;
}
