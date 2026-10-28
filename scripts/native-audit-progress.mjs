import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const sourceCommit = "fd7acd1277ddbe2ab1250f74597046871ea44473";
function read(args) {
  const result = spawnSync("eas", args, { cwd: "apps/mobile", encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error("Read-only Expo query failed; no raw response logged.");
  return JSON.parse(result.stdout);
}
const runs = read(["workflow:runs", "--workflow", "native-ui-recheck.yml", "--limit", "5", "--json"]);
const selected = runs.find(run => run.gitCommitHash === sourceCommit);
if (!selected || !/^[0-9a-f-]{36}$/.test(selected.id)) throw new Error("Requested verification run was not found.");
const run = read(["workflow:view", selected.id, "--json", "--non-interactive"]);
if (run.gitCommitHash !== sourceCommit || run.workflow?.app?.id !== "e5dbc3ba-25fb-4373-8ded-c8c80cadc147" || run.workflow.app.ownerAccount?.name !== "alpha-traders") throw new Error("Run ownership or source does not match.");
const progress = { id: run.id, status: run.status, sourceCommit, observedAt: new Date().toISOString(),
  jobs: run.jobs.map(({ id, key, type, status, createdAt, updatedAt }) => ({ id, key, type, status, createdAt, updatedAt })) };
await mkdir("native-failure-evidence", { recursive: true });
await writeFile("native-failure-evidence/current-progress.json", JSON.stringify(progress, null, 2) + "\n");
console.log("NATIVE_PROGRESS " + JSON.stringify(progress));
