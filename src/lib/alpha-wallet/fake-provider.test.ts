// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELLER, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import { createFileFakeProvider, SimulatedProviderResponseLostError } from "./fake-provider";
import type { Payout } from "./types";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "alpha-wallet-provider-test-"));
  directories.push(path);
  return path;
}
function intent(assetId: AssetId = TRON): Payout {
  return {
    id: "withdrawal-provider-test", sellerId: SELLER.id, assetId, kind: "withdrawal",
    amountRaw: parseUnits("500.000001", assetFor(assetId).decimals),
    destination: `sim://${assetId}/recipient/fixture-recipient`, state: "submitting",
    providerReference: "sim-payout-withdrawal-provider-test", dispatchCount: 1,
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("persistent offline payout provider", () => {
  it("opens one fresh directory concurrently and publishes an identical transfer only once", async () => {
    const path = await directory();
    const providers = await Promise.all(Array.from({ length: 4 }, () => createFileFakeProvider({ mode: "simulation-only", dataDir: path })));
    const payout = intent();
    const records = await Promise.all(providers.flatMap(provider => [provider.submit(payout), provider.submit(payout)]));
    expect(new Set(records.map(record => record.transactionId)).size).toBe(1);
    expect(records.every(record => record.intent.amountRaw === payout.amountRaw.toString())).toBe(true);
    expect((await readdir(path)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
    expect((await readdir(path)).filter(name => name.startsWith(".pending-"))).toHaveLength(0);
    await Promise.all(providers.map(provider => provider.finalize(payout, true)));
    expect((await readdir(path)).filter(name => name.endsWith(".finality.json"))).toHaveLength(1);
    expect(await providers[0].lookup(payout)).toMatchObject({ status: "finalized", receipt: { successful: true, amountRaw: payout.amountRaw.toString() } });
  });

  it.each(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"] as const)("retains exact %s units and the same reference after reopening", async assetId => {
    const path = await directory(), payout = intent(assetId);
    const original = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    const accepted = await original.submit(payout);
    const reopened = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    const found = await reopened.lookup(payout);
    expect(found).toEqual({ status: "broadcast", record: accepted });
    expect(found.status !== "not_found" && found.record.intent.amountRaw).toBe(payout.amountRaw.toString());
    expect(await reopened.submit(payout)).toEqual(accepted);
    expect((await readdir(path)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
  });

  it("rejects changed terms for a consumed reference without replacing the original record", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    const accepted = await provider.submit(payout);
    const file = (await readdir(path)).find(name => name.endsWith(".broadcast.json"))!;
    const original = await readFile(join(path, file), "utf8");
    const changed: Payout[] = [
      { ...payout, amountRaw: payout.amountRaw + BigInt(1) },
      { ...payout, destination: `sim://${TRON}/recipient/changed-recipient` },
      { ...payout, assetId: "bsc-sim-binance-peg-usdt", destination: "sim://bsc-sim-binance-peg-usdt/recipient/fixture-recipient" },
    ];
    for (const replacement of changed) {
      await expect(provider.submit(replacement)).rejects.toThrow(/different immutable terms/);
      await expect(provider.lookup(replacement)).rejects.toThrow(/immutable payout intent/);
    }
    expect(await readFile(join(path, file), "utf8")).toBe(original);
    expect(await provider.lookup(payout)).toEqual({ status: "broadcast", record: accepted });
  });

  it("records acceptance durably even when its response is deliberately lost", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    await expect(provider.submit(payout, { loseResponseAfterAccept: true })).rejects.toBeInstanceOf(SimulatedProviderResponseLostError);
    const reopened = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    const found = await reopened.lookup(payout);
    expect(found.status).toBe("broadcast");
    expect(await reopened.submit(payout)).toEqual(found.status === "broadcast" ? found.record : undefined);
    expect((await readdir(path)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
  });

  it("never overwrites a final success with failure or manufactures finality before acceptance", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    await expect(provider.finalize(payout, true)).rejects.toThrow(/no accepted transfer/);
    await provider.submit(payout);
    const first = await provider.finalize(payout, true);
    expect(await provider.finalize(payout, true)).toEqual(first);
    await expect(provider.finalize(payout, false)).rejects.toThrow(/different immutable terms/);
    expect(await provider.lookup(payout)).toEqual(first);
  });

  it("rejects real chain addresses, wrong assets, mutable references, and missing dispatch claims", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    const invalid: Payout[] = [
      { ...payout, destination: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
      { ...payout, destination: "0x55d398326f99059fF775485246999027B3197955" },
      { ...payout, destination: "sim://bsc-sim-binance-peg-usdt/recipient/fixture-recipient" },
      { ...payout, providerReference: "mainnet-payout-reference" },
      { ...payout, assetId: "mainnet-usdt" as AssetId },
      { ...payout, amountRaw: BigInt(2) ** BigInt(256) },
      { ...payout, state: "queued", dispatchCount: 0 },
      { ...payout, dispatchCount: 0 },
    ];
    for (const rejected of invalid) await expect(provider.submit(rejected)).rejects.toThrow();
    expect((await readdir(path)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(0);
  });

  it("detects modified provider evidence and refuses to repair it by overwriting", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    await provider.submit(payout);
    const file = (await readdir(path)).find(name => name.endsWith(".broadcast.json"))!;
    const corrupted = JSON.parse(await readFile(join(path, file), "utf8"));
    corrupted.transactionId = `sim-tx-${"f".repeat(64)}`;
    const altered = JSON.stringify(corrupted);
    await writeFile(join(path, file), altered);
    await expect(provider.lookup(payout)).rejects.toThrow(/evidence disagrees/);
    await expect(provider.submit(payout)).rejects.toThrow(/different immutable terms/);
    expect(await readFile(join(path, file), "utf8")).toBe(altered);
  });

  it("refuses unrelated folders and symlinked directories without altering their files", async () => {
    const path = await directory();
    await writeFile(join(path, "unrelated.txt"), "keep this file");
    await expect(createFileFakeProvider({ mode: "simulation-only", dataDir: path })).rejects.toThrow(/unmarked nonempty/);
    const parent = await directory(), redirect = join(parent, "redirect");
    await symlink(path, redirect, "dir");
    await expect(createFileFakeProvider({ mode: "simulation-only", dataDir: redirect })).rejects.toThrow(/real directory/);
    expect(await readFile(join(path, "unrelated.txt"), "utf8")).toBe("keep this file");
    expect(await readdir(path)).toEqual(["unrelated.txt"]);
  });

  it("rechecks the runtime before every provider operation", async () => {
    const path = await directory(), payout = intent();
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: path });
    vi.stubEnv("NODE_ENV", "production");
    await expect(provider.submit(payout)).rejects.toThrow(/local development or test runtime/);
    await expect(provider.lookup(payout)).rejects.toThrow(/local development or test runtime/);
    await expect(provider.finalize(payout, true)).rejects.toThrow(/local development or test runtime/);
    expect((await readdir(path)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(0);
  });
});
