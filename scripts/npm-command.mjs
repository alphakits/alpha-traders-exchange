import { existsSync } from "node:fs";
import path from "node:path";

/** Invoke npm without a command shell, including Windows installations. */
export function getNpmCommand({ platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform !== "win32") return { command: "npm", prefixArgs: [] };
  const candidates = [env.npm_execpath, path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && path.basename(candidate) === "npm-cli.js" && exists(candidate)) {
      return { command: execPath, prefixArgs: [candidate] };
    }
  }
  throw new Error("npm CLI could not be located. Run this check through npm or install npm beside Node.js.");
}
