import { validateEnv } from "../src/lib/env-validation";
import { validateUsdtReleaseRuntime, validateUsdtReleaseState } from "../src/lib/usdt-release-config";

const args = process.argv.slice(2);
if (args.length !== 1 || !["--feature=off", "--feature=on"].includes(args[0])) {
  console.error("Usage: node --conditions=react-server --import tsx scripts/usdt-release-preflight.ts --feature=off|on");
  process.exitCode = 2;
} else {
  const expected = args[0] === "--feature=on" ? "on" : "off";
  const errors = [...new Set([...validateUsdtReleaseRuntime(), ...validateUsdtReleaseState(process.env, expected), ...validateEnv().errors])];
  console.log(JSON.stringify({ check: "usdt-release-configuration", expectedFeature: expected, passed: errors.length === 0, errors }, null, 2));
  console.log("Configuration only: no database, provider, notification, deployment, or feature flag was changed or contacted. Staging evidence remains required.");
  if (errors.length) process.exitCode = 1;
}
