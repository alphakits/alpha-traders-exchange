// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { runWorkerDependencyAudit } from "../../scripts/check-worker-dependency-advisories.mjs";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: spawnMock }));
const clean = { auditReportVersion: 2, vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
const result = (report: unknown, status = 0) => ({ status, stdout: JSON.stringify(report), stderr: "" });
const workerDirectory = fileURLToPath(new URL("../../discord-worker/", import.meta.url));
const reportFor = (name: string, url: string) => ({
  auditReportVersion: 2,
  vulnerabilities: { [name]: { severity: "high", via: [{ name, severity: "high", url }] } },
  metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1, total: 1 } },
});

beforeEach(() => {
  spawnMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("standalone worker dependency gate", () => {
  it("audits the worker lockfile independently of the caller working directory", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/unrelated-launch-directory");
    spawnMock.mockReturnValue(result(clean));
    expect(() => runWorkerDependencyAudit()).not.toThrow();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][1]).toEqual(expect.arrayContaining(["audit", "--omit=dev", "--json"]));
    expect(spawnMock.mock.calls[0][2].cwd).toBe(workerDirectory);
  });
  it("blocks the worker's Zod advisory even when the web workspace is clean", () => {
    spawnMock.mockImplementation((_command, _args, options) =>
      result(options.cwd === workerDirectory
        ? reportFor("zod", "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5") : clean, 1));
    expect(() => runWorkerDependencyAudit()).toThrow(/Worker dependency advisories/);
  });
  it("does not inherit root-only verified backport exceptions", () => {
    spawnMock.mockReturnValue(result(reportFor("braces", "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"), 1));
    expect(() => runWorkerDependencyAudit()).toThrow(/Worker dependency advisories/);
  });
  it("fails closed when the worker audit is incomplete", () => {
    spawnMock.mockReturnValue(result({ auditReportVersion: 2, vulnerabilities: {} }));
    expect(() => runWorkerDependencyAudit()).toThrow(/complete version-2 report/);
  });
});
