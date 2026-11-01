import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessDependencyAudit, readFreshDependencyAudit } from "./check-dependency-advisories.mjs";

export function runWorkerDependencyAudit() {
  // Docker installs this standalone lockfile, not the root workspace lockfile.
  // Root-only backports must never authorize an exception for this installation.
  const cwd = fileURLToPath(new URL("../discord-worker/", import.meta.url));
  const assessment = assessDependencyAudit(readFreshDependencyAudit({ cwd }));
  console.log(JSON.stringify({ scope: "discord-worker", ...assessment }, null, 2));
  if (assessment.blockers.length) throw new Error("Worker dependency advisories block release.");
  console.log("Standalone worker dependency advisory gate passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { runWorkerDependencyAudit(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
