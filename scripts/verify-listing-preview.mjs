import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

// Verification-only runner: keep the existing release gate and isolate test
// processes from deployed service credentials and production NODE_ENV.
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR || "/tmp",
  CI: "1",
  EXPO_NO_TELEMETRY: "1",
  NEXT_PUBLIC_SITE_URL: "https://www.alphatraders.co.il",
  NEXT_PUBLIC_SUPABASE_URL: "https://ci-placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-placeholder-anon-key",
};

let recentOutput = "";
const child = spawn(process.execPath, ["scripts/release-safety-gate.mjs"], {
  cwd: process.cwd(),
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
});

function relay(chunk, stream) {
  stream.write(chunk);
  recentOutput = (recentOutput + chunk.toString()).slice(-512_000);
}
child.stdout.on("data", (chunk) => relay(chunk, process.stdout));
child.stderr.on("data", (chunk) => relay(chunk, process.stderr));

child.on("error", (error) => {
  console.error("Verification runner could not start:", error.message);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (code === 0) {
    process.exit(0);
  }

  const clean = stripVTControlCharacters(recentOutput);
  const stages = [...clean.matchAll(/^\[\d+\/\d+\] .+$/gm)];
  const failedStage = stages[stages.length - 1];
  const details = failedStage ? clean.slice(failedStage.index) : clean;
  const report = details
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("npm error"))
    .slice(-100)
    .join("\n")
    .trim();

  console.error("\n===== EXACT FAILED CHECK: COPY THIS REPORT =====");
  console.error(report || "No diagnostic output was emitted by the release gate.");
  console.error("===== END FAILED CHECK REPORT =====");
  console.error("Release verification failed:", signal || code || "unknown exit");
  process.exit(typeof code === "number" && code !== 0 ? code : 1);
});
