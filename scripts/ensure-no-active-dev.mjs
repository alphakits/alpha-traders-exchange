import { execSync } from "node:child_process";
import path from "node:path";

const cwd = process.cwd().toLowerCase();
const selfPid = process.pid;

function collectProcesses() {
  try {
    if (process.platform === "win32") {
      const output = execSync("wmic process get ProcessId,CommandLine /FORMAT:CSV", { encoding: "utf8" });
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(",");
          const pid = Number(parts[parts.length - 1] ?? "");
          const command = parts.slice(1, -1).join(",").trim();
          return { pid, command };
        })
        .filter((item) => Number.isFinite(item.pid) && item.pid > 0 && item.command);
    }

    const output = execSync("ps -ax -o pid=,command=", { encoding: "utf8" });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const spaceIndex = line.indexOf(" ");
        if (spaceIndex <= 0) return null;
        const pid = Number(line.slice(0, spaceIndex).trim());
        const command = line.slice(spaceIndex + 1).trim();
        return { pid, command };
      })
      .filter((item) => item && Number.isFinite(item.pid) && item.pid > 0 && item.command);
  } catch {
    return [];
  }
}

function commandLooksLikeNextDev(command) {
  const normalized = command.toLowerCase();
  return (
    normalized.includes("next dev") ||
    normalized.includes(`${path.sep}next${path.sep}dist${path.sep}server${path.sep}lib${path.sep}start-server.js`)
  );
}

function commandTargetsCurrentRepo(command) {
  return command.toLowerCase().includes(cwd);
}

const activeDevServers = collectProcesses().filter((proc) => {
  if (proc.pid === selfPid) return false;
  if (!commandLooksLikeNextDev(proc.command)) return false;
  return commandTargetsCurrentRepo(proc.command);
});

if (activeDevServers.length > 0) {
  const details = activeDevServers.map((proc) => `PID ${proc.pid}`).join(", ");
  console.error(
    [
      "Active `next dev` process detected for this repository.",
      `Conflicting process(es): ${details}`,
      "Stop dev server(s) before running `npm run build` to avoid `.next` artifact corruption.",
    ].join("\n"),
  );
  process.exit(1);
}
