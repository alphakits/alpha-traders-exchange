import { spawnSync } from "node:child_process";

// Preview-only verification uses the same repository gate in a CI-like
// environment, without inheriting deployed service credentials or NODE_ENV.
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
const result = spawnSync(process.execPath, ["scripts/release-safety-gate.mjs"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
