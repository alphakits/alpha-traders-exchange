import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const INTERVAL_MS = 5 * 60_000;
const MAXIMUM_GAP_MS = 15 * 60_000;
const PROBE_TIMEOUT_MS = 240_000;
const HISTORY_LIMIT = 24;

type HealthStatus = "healthy" | "component_degraded" | "verification_limited";
type Incident = { kind: string; component: string; code: string };

export type ProductionHealthObservation = {
  startedUtc: string;
  finishedUtc: string;
  complete: boolean;
  status: HealthStatus;
  activeIncidents: Record<string, Incident>;
  coverageGaps: string[];
};

export type ProductionHealthSnapshot = {
  schemaVersion: 1;
  source: "railway-worker";
  intervalSeconds: number;
  maximumGapSeconds: number;
  status: HealthStatus;
  continuousSinceUtc: string | null;
  latest: ProductionHealthObservation | null;
  history: ProductionHealthObservation[];
};

type Probe = (output: string, previous: string | undefined, signal: AbortSignal) => Promise<ProductionHealthObservation>;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function publicComponent(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048
    && /^(?:(?:keepalive:)?\/(?:api|en|ar)(?:\/[a-z-]+)*|\/|network|coverage|scheduler|https:\/\/www\.alphatraders\.co\.il\/_next\/static\/[a-zA-Z0-9_./?=&%-]+)$/.test(value);
}

// Never serve probe bodies, headers, process errors, Discord diagnostics or credentials.
export function readProductionHealthObservation(value: unknown): ProductionHealthObservation {
  const report = value as Partial<ProductionHealthObservation> | null;
  if (!report || !validTimestamp(report.startedUtc) || !validTimestamp(report.finishedUtc)
    || Date.parse(report.finishedUtc) < Date.parse(report.startedUtc)
    || typeof report.complete !== "boolean"
    || !["healthy", "component_degraded", "verification_limited"].includes(report.status ?? "")
    || !Array.isArray(report.coverageGaps) || report.coverageGaps.length > 150
    || !report.coverageGaps.every(publicComponent)
    || !report.activeIncidents || typeof report.activeIncidents !== "object"
    || Array.isArray(report.activeIncidents) || Object.keys(report.activeIncidents).length > 150) {
    throw new Error("Invalid public production observation");
  }
  const activeIncidents: Record<string, Incident> = {};
  for (const incident of Object.values(report.activeIncidents)) {
    if (!incident || !["component", "unconfirmed", "monitoring", "connection"].includes(incident.kind)
      || !publicComponent(incident.component) || !/^[a-z_]{1,100}$/.test(incident.code)) {
      throw new Error("Invalid public production incident");
    }
    activeIncidents[`${incident.kind}:${incident.component}:${incident.code}`] = {
      kind: incident.kind, component: incident.component, code: incident.code,
    };
  }
  if (report.status === "healthy"
    && (!report.complete || report.coverageGaps.length || Object.keys(activeIncidents).length)) {
    throw new Error("Contradictory public production observation");
  }
  return {
    startedUtc: report.startedUtc,
    finishedUtc: report.finishedUtc,
    complete: report.complete,
    status: report.status as HealthStatus,
    activeIncidents,
    coverageGaps: [...report.coverageGaps],
  };
}

export async function runProductionHealthProbe(
  output: string, previous: string | undefined, signal: AbortSignal,
): Promise<ProductionHealthObservation> {
  const args = [resolve(process.cwd(), "scripts/production_health.py"), "--output", output];
  if (previous) args.push("--previous", previous);
  await new Promise<void>((done, reject) => {
    // A process group lets timeout/shutdown also stop an in-flight curl child.
    const child = spawn("python3", args, { detached: true, stdio: "ignore" });
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
      }
    };
    const timeout = setTimeout(stop, PROBE_TIMEOUT_MS);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (stopped || code === null || ![0, 1, 2].includes(code)) {
        reject(new Error("Public production probe did not complete"));
      } else done();
    });
  });
  if ((await stat(output)).size > 4 * 1024 * 1024) {
    throw new Error("Public production observation is too large");
  }
  return readProductionHealthObservation(JSON.parse(await readFile(output, "utf8")));
}

export class ProductionHealthWorker {
  private readonly probe: Probe;
  private readonly now: () => number;
  private directory: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private startPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private previous: string | undefined;
  private history: ProductionHealthObservation[] = [];
  private continuousSinceUtc: string | null = null;

  constructor({ probe = runProductionHealthProbe, now = Date.now }: { probe?: Probe; now?: () => number } = {}) {
    this.probe = probe;
    this.now = now;
  }

  start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.performStart();
    return this.startPromise;
  }

  private async performStart(): Promise<void> {
    if (this.shutdownPromise) return;
    this.running = true;
    try {
      this.directory = await mkdtemp(join(tmpdir(), "alpha-public-health-"));
    } catch {
      this.running = false;
      // Monitoring unavailability must not stop the Discord service.
      return;
    }
    if (this.running) this.scheduleProbe();
    else {
      await rm(this.directory, { recursive: true, force: true });
      this.directory = null;
    }
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    this.running = false;
    await this.startPromise;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    await this.inFlight;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
    this.directory = null;
  }

  getSnapshot(): ProductionHealthSnapshot {
    const latest = this.history.at(-1) ?? null;
    const age = latest ? this.now() - Date.parse(latest.finishedUtc) : Infinity;
    const fresh = this.running && age >= -60_000 && age <= MAXIMUM_GAP_MS;
    return {
      schemaVersion: 1,
      source: "railway-worker",
      intervalSeconds: INTERVAL_MS / 1000,
      maximumGapSeconds: MAXIMUM_GAP_MS / 1000,
      status: fresh && latest ? latest.status : "verification_limited",
      continuousSinceUtc: fresh ? this.continuousSinceUtc : null,
      latest,
      history: [...this.history],
    };
  }

  private scheduleProbe(): void {
    const started = this.now();
    this.controller = new AbortController();
    this.inFlight = this.observe(started, this.controller.signal).finally(() => {
      this.inFlight = null;
      this.controller = null;
      if (this.running) {
        this.timer = setTimeout(() => this.scheduleProbe(), Math.max(1000, INTERVAL_MS - (this.now() - started)));
        this.timer.unref();
      }
    });
  }

  private async observe(started: number, signal: AbortSignal): Promise<void> {
    if (!this.directory) return;
    // Alternate files so the previous artifact survives partial/failed probes.
    const output = join(this.directory, this.previous?.endsWith("a.json") ? "b.json" : "a.json");
    let observation: ProductionHealthObservation;
    try {
      observation = readProductionHealthObservation(await this.probe(output, this.previous, signal));
      const finished = Date.parse(observation.finishedUtc);
      if (Date.parse(observation.startedUtc) < started - 60_000 || finished > this.now() + 60_000) {
        throw new Error("Unexpected public production probe timestamp");
      }
      this.previous = output;
    } catch {
      if (signal.aborted) return;
      observation = {
        startedUtc: new Date(started).toISOString(),
        finishedUtc: new Date(this.now()).toISOString(),
        complete: false,
        status: "verification_limited",
        coverageGaps: [],
        activeIncidents: {
          "monitoring:coverage:probe_failed": { kind: "monitoring", component: "coverage", code: "probe_failed" },
        },
      };
    }
    if (signal.aborted) return;
    const previous = this.history.at(-1);
    const gap = previous ? Date.parse(observation.startedUtc) - Date.parse(previous.finishedUtc) : Infinity;
    if (!observation.complete || observation.coverageGaps.length) this.continuousSinceUtc = null;
    else if (!this.continuousSinceUtc || gap > MAXIMUM_GAP_MS || gap < -60_000) {
      this.continuousSinceUtc = observation.startedUtc;
    }
    this.history.push(observation);
    this.history = this.history.slice(-HISTORY_LIMIT);
    // Do not claim an observation window older than the retained evidence.
    if (this.continuousSinceUtc && Date.parse(this.continuousSinceUtc) < Date.parse(this.history[0].startedUtc)) {
      this.continuousSinceUtc = this.history[0].startedUtc;
    }
  }
}
