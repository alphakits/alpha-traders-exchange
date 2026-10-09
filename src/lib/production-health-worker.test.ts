// @vitest-environment node

import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

import {
  ProductionHealthWorker,
  readProductionHealthObservation,
  runProductionHealthProbe,
  type ProductionHealthObservation,
} from "@/lib/production-health-worker";

const epoch = Date.parse("2026-10-09T20:00:00Z");
const workers: ProductionHealthWorker[] = [];
const directories: string[] = [];
const report = (now = epoch): ProductionHealthObservation => ({
  startedUtc: new Date(now).toISOString(),
  finishedUtc: new Date(now).toISOString(),
  complete: true,
  status: "healthy",
  coverageGaps: [],
  activeIncidents: {},
});

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.shutdown()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawn.mockReset();
});

describe("continuous public production health", () => {
  it("serves an allowlisted summary without response bodies or private diagnostics", () => {
    expect(readProductionHealthObservation({
      ...report(), observations: [{ body: "private" }], headers: { cookie: "private" }, token: "private",
    })).toEqual(report());
    expect(() => readProductionHealthObservation({
      ...report(), status: "component_degraded",
      activeIncidents: { unsafe: { kind: "component", component: "private-account", code: "failed" } },
    })).toThrow();
    expect(() => readProductionHealthObservation({ ...report(), complete: false })).toThrow();
    expect(() => readProductionHealthObservation({ ...report(), coverageGaps: ["/api/health"] })).toThrow();
    expect(() => readProductionHealthObservation({ ...report(), finishedUtc: "2020-01-01" })).toThrow();
  });

  it("starts immediately, checks every five minutes and never overlaps probes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    let finish!: (value: ProductionHealthObservation) => void;
    const probe = vi.fn(() => new Promise<ProductionHealthObservation>((resolve) => { finish = resolve; }));
    const worker = new ProductionHealthWorker({ probe });
    workers.push(worker);
    await worker.start();
    await worker.start();
    expect(probe).toHaveBeenCalledOnce();
    expect(worker.getSnapshot().status).toBe("verification_limited");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(probe).toHaveBeenCalledOnce();
    finish({ ...report(epoch), finishedUtc: new Date(epoch + 300_000).toISOString() });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(2);
    finish(report(epoch + 301_000));
    await flush();
    expect(worker.getSnapshot().status).toBe("healthy");
    await worker.shutdown();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(worker.getSnapshot().status).toBe("verification_limited");
  });

  it("retains failures between checks and resets continuity after missing coverage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    const probe = vi.fn(async () => report(Date.now()));
    const worker = new ProductionHealthWorker({ probe });
    workers.push(worker);
    await worker.start();
    await flush();
    expect(worker.getSnapshot().continuousSinceUtc).toBe(report().startedUtc);
    probe.mockRejectedValueOnce(new Error("private process details must not escape"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(worker.getSnapshot()).toMatchObject({ status: "verification_limited", continuousSinceUtc: null });
    expect(JSON.stringify(worker.getSnapshot())).not.toContain("private process");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(worker.getSnapshot()).toMatchObject({ status: "healthy", continuousSinceUtc: report(epoch + 600_000).startedUtc });
    expect(worker.getSnapshot().history.map((item) => item.status)).toEqual(["healthy", "verification_limited", "healthy"]);
  });

  it("fails closed for a stale heartbeat, clock skew and a stale reused artifact", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    let now = epoch;
    const worker = new ProductionHealthWorker({ probe: async () => report(), now: () => now });
    workers.push(worker);
    await worker.start();
    await flush();
    now += 900_001;
    expect(worker.getSnapshot()).toMatchObject({ status: "verification_limited", continuousSinceUtc: null });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(worker.getSnapshot().latest?.complete).toBe(false);
    now = epoch - 60_001;
    expect(worker.getSnapshot().status).toBe("verification_limited");
  });

  it("keeps bounded history and cannot advertise coverage older than the evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    const worker = new ProductionHealthWorker({ probe: async () => report(Date.now()) });
    workers.push(worker);
    await worker.start();
    await flush();
    await vi.advanceTimersByTimeAsync(25 * 300_000);
    const snapshot = worker.getSnapshot();
    expect(snapshot.history).toHaveLength(24);
    expect(snapshot.continuousSinceUtc).toBe(snapshot.history[0].startedUtc);
  });

  it("aborts the active probe on shutdown without scheduling another or claiming recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch);
    const aborted = vi.fn();
    const probe = vi.fn((_output, _previous, signal: AbortSignal) => new Promise<ProductionHealthObservation>((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }, { once: true });
    }));
    const worker = new ProductionHealthWorker({ probe });
    workers.push(worker);
    await worker.start();
    await worker.shutdown();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(aborted).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledOnce();
    expect(worker.getSnapshot()).toMatchObject({ status: "verification_limited", latest: null });
  });
});

describe("production health subprocess", () => {
  it("accepts a completed degraded report and forwards history without a shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-health-test-"));
    directories.push(directory);
    const output = join(directory, "report.json");
    const degraded = { ...report(), status: "component_degraded" as const,
      activeIncidents: { "component:/api/health:http_error": { kind: "component", component: "/api/health", code: "http_error" } } };
    await writeFile(output, JSON.stringify(degraded));
    const child = Object.assign(new EventEmitter(), { pid: 123 });
    spawn.mockReturnValue(child);
    const promise = runProductionHealthProbe(output, "previous.json", new AbortController().signal);
    child.emit("close", 1);
    await expect(promise).resolves.toEqual(degraded);
    expect(spawn).toHaveBeenCalledWith("python3", expect.arrayContaining(["--previous", "previous.json"]), { detached: true, stdio: "ignore" });
  });

  it.each(["timeout", "shutdown"])("kills the entire probe process group on %s", async (reason) => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { pid: 123 });
    spawn.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { child.emit("close", null); return true; });
    const controller = new AbortController();
    const promise = runProductionHealthProbe("unused.json", undefined, controller.signal);
    const rejected = expect(promise).rejects.toThrow("did not complete");
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(240_000);
    else controller.abort();
    await rejected;
    expect(kill).toHaveBeenCalledExactlyOnceWith(-123, "SIGKILL");
  });
});
