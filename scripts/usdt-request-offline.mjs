import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFLINE_ACCOUNTS, OFFLINE_PASSWORD, seedOfflineFixture } from "./usdt-request-offline-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = process.argv.includes("--build");
const production = process.argv.includes("--production");
if (build && production) throw new Error("Use --build or --production, not both.");
const portArgument = process.argv.indexOf("--port");
const port = portArgument < 0 ? 3210 : Number(process.argv[portArgument + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose an unprivileged local port, for example --port 3210.");
// Match Next's canonical loopback origin used by the existing CSRF checks.
const baseURL = `http://localhost:${port}`;
if (process.argv.includes("--seed-only")) throw new Error("Standalone fixture resets are disabled. Restart the isolated preview instead.");
// Never let Next load a developer's deployment credentials. The harness also
// starts from an OS-only environment instead of forwarding process.env.
const envFiles = (await readdir(root)).filter(name => /^\.env(?:\.|$)/.test(name) && name !== ".env.example");
if (envFiles.length) throw new Error(`Run this preview in a clean checkout without .env files (${envFiles.join(", ")}).`);
if (!existsSync(path.join(root, "node_modules/next/dist/bin/next"))) throw new Error("Install dependencies with npm ci before running the offline preview.");
if (production && !existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("Run the isolated --build command before --production.");
if (!build) await new Promise((resolve, reject) => {
  const probe = createServer(); probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
// Keep snapshots outside Next's checkout watcher: a login must not trigger HMR.
const runtimeParent = path.resolve(root, "..", "usdt-offline-runtime");
await mkdir(runtimeParent, { recursive: true });
const runtimeTemp = await mkdtemp(path.join(runtimeParent, "run-"));
const osKeys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "userprofile", "appdata", "localappdata", "number_of_processors", "processor_architecture"]);
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toLowerCase())));
// NODE_OPTIONS parses backslashes as escapes even on Windows.
const guard = path.join(root, "scripts", "usdt-request-offline-network.cjs").replaceAll("\\", "/");
Object.assign(environment, {
  NODE_ENV: build || production ? "production" : "development", NODE_OPTIONS: `--require="${guard}"`, NEXT_TELEMETRY_DISABLED: "1", __NEXT_PROCESSED_ENV: "1",
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.join(root, "scripts/usdt-request-offline-fonts.cjs"),
  TEMP: runtimeTemp, TMP: runtimeTemp, TMPDIR: runtimeTemp,
  ALPHA_USDT_OFFLINE_PREVIEW: "1", ALPHA_E2E_TEST_SUPPORT: "1", ALPHA_E2E_LOOPBACK_ONLY: "1",
  ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1", ALPHA_USDT_REQUESTS_ENABLED: "1",
  ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "0", ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: "false",
  ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: "false", ALPHA_FX_REFERENCE_URL: "https://usdt-offline.invalid/quote",
  ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET: "offline-preview-synthetic-credentials-only",
  NEXT_PUBLIC_SITE_URL: baseURL, NEXT_PUBLIC_APP_URL: baseURL,
});
const childArgs = build ? [path.join(root, "scripts/build-production.mjs")]
  : [path.join(root, "node_modules/next/dist/bin/next"), production ? "start" : "dev", "-H", "127.0.0.1", "-p", String(port),
    ...(production ? ["--keepAliveTimeout", "65000"] : [])];
const server = spawn(process.execPath, childArgs, {
  cwd: root, env: environment, stdio: "inherit", windowsHide: true,
});
server.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.kill(signal); });

if (build) {
  console.log("Building the isolated offline preview with external networking blocked. No server or fixture reset is started.");
} else try {
  let ready = false;
  const readinessDeadline = Date.now() + 180_000;
  while (Date.now() < readinessDeadline && !ready) {
    try {
      const response = await fetch(`${baseURL}/api/testing/alpha-exchange-state`, {
        headers: { "x-alpha-test-support": "enabled" }, signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, readinessDeadline - Date.now()))),
      });
      ready = response.ok;
    } catch { /* The dev process may still be starting or compiling. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("The offline preview did not become ready.");
  if (!process.argv.includes("--no-seed")) await seedOfflineFixture(baseURL);
  console.log(`\nOffline USDT preview ready: ${baseURL}/en/usdt-exchange/requests`);
  console.log(`Login: ${baseURL}/en/login?redirectTo=/en/usdt-exchange/requests`);
  console.log(`Buyer: ${OFFLINE_ACCOUNTS.buyer.email} | Seller: ${OFFLINE_ACCOUNTS.seller.email}`);
  console.log(`Synthetic demo password: ${OFFLINE_PASSWORD}`);
  console.log("Reference fixed at 3.30 ILS. External server networking blocked. Email/SMS credentials absent. Ctrl+C stops the preview.\n");
} catch (error) {
  server.kill();
  throw error;
}
