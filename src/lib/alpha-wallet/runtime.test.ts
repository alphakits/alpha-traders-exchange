// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSimulationRuntime } from "./runtime";
import { createAlphaWalletSandbox } from "./sandbox";

afterEach(() => vi.unstubAllEnvs());
describe("simulation cannot become a deployed wallet", () => {
  it("is disabled without explicit opt-in", () => {
    expect(() => assertSimulationRuntime(undefined, { NODE_ENV: "test" })).toThrow(/disabled/);
    expect(() => assertSimulationRuntime("mainnet", { NODE_ENV: "development" })).toThrow(/disabled/);
  });
  it.each(["production", "", undefined])("rejects non-local NODE_ENV %s", NODE_ENV => {
    expect(() => assertSimulationRuntime("simulation-only", { NODE_ENV })).toThrow(/local/);
  });
  it.each(["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE"])("refuses hosted execution through %s", key => {
    expect(() => assertSimulationRuntime("simulation-only", { NODE_ENV: "test", [key]: "enabled" })).toThrow(/hosted/);
  });
  it.each(["ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])("rejects attempted enable flag %s", key => {
    expect(() => assertSimulationRuntime("simulation-only", { NODE_ENV: "test", [key]: "1" })).toThrow(/signing/);
  });
  it("factory checks the real environment and rechecks each mutation", () => {
    vi.stubEnv("NODE_ENV", "test");
    const sandbox = createAlphaWalletSandbox({ mode: "simulation-only" });
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createAlphaWalletSandbox({ mode: "simulation-only" })).toThrow(/local/);
    expect(() => sandbox.createDepositIntent({ kind: "seller", id: "seller" }, "deposit", { id: "deposit", assetId: "tron-sim-usdt", purpose: "principal" })).toThrow(/local/);
    expect(sandbox.snapshot().journal).toHaveLength(0);
  });
});
