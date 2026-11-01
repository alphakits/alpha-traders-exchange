// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDependencyAudit } from "../../scripts/check-dependency-advisories.mjs";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: spawnMock }));
const clean = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
};
const complete = (body: unknown = clean, status = 0) => ({
  status, stdout: JSON.stringify(body), stderr: "", error: undefined,
});
const timeout = () => ({
  status: null, stdout: "", stderr: "untrusted registry diagnostic",
  error: Object.assign(new Error("untrusted registry diagnostic"), { code: "ETIMEDOUT" }),
});
let elapsed = 0;

beforeEach(() => {
  elapsed = 0;
  spawnMock.mockReset();
  spawnMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 0 });
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("fresh dependency audit transport", () => {
  it("recovers from a stalled child using a new fresh audit", () => {
    spawnMock.mockImplementationOnce(() => { elapsed += 30_000; return timeout(); });
    spawnMock.mockReturnValueOnce(complete());
    expect(() => runDependencyAudit()).not.toThrow();
    expect(spawnMock).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("PROCESS_TIMEOUT"));
    for (const call of spawnMock.mock.calls.slice(2)) {
      expect(call[1]).toEqual(expect.arrayContaining(["audit", "--omit=dev", "--json", "--fetch-timeout=10000", "--fetch-retries=0"]));
      expect(call[2]).toMatchObject({ timeout: 30_000, killSignal: "SIGKILL" });
    }
  });

  it("recognizes npm's real timeout envelope without logging its URL", () => {
    spawnMock.mockReturnValueOnce(complete({
      message: "network timeout at: https://user:secret@registry.example/-/npm/v1/security/advisories/bulk",
      error: { summary: "", detail: "" },
    }, 1)).mockReturnValueOnce(complete());
    expect(() => runDependencyAudit()).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("REQUEST_TIMEOUT"));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret");
  });

  it.each([429, 502, 503, 504])("retries temporary HTTP %i responses", statusCode => {
    spawnMock.mockReturnValueOnce(complete({ statusCode, error: { summary: "unavailable" } }, 1))
      .mockReturnValueOnce(complete());
    expect(() => runDependencyAudit()).not.toThrow();
  });

  it("fails closed after three stalls within the original 90-second budget", () => {
    const limits: number[] = [];
    spawnMock.mockImplementation((_command, _args, options) => {
      limits.push(options.timeout); elapsed += options.timeout; return timeout();
    });
    expect(() => runDependencyAudit()).toThrow(/release remains blocked/);
    expect(limits).toEqual([30_000, 30_000, 30_000]);
    expect(elapsed).toBe(90_000);
  });

  it("caps the final child by the remaining deadline and never starts a fourth attempt", () => {
    const limits: number[] = [];
    spawnMock.mockImplementation((_command, _args, options) => {
      limits.push(options.timeout); elapsed += options.timeout + 5_000; return timeout();
    });
    expect(() => runDependencyAudit()).toThrow(/release remains blocked/);
    expect(limits).toEqual([30_000, 30_000, 20_000]);
    expect(spawnMock).toHaveBeenCalledTimes(5);
  });

  it.each([
    { status: 1, stdout: "{broken", stderr: "", error: undefined },
    complete({ error: { code: "E401", summary: "auth failed" }, statusCode: 401 }, 1),
    complete({ error: { code: "CERT_HAS_EXPIRED" } }, 1),
    complete({ error: { code: "EUNKNOWN" } }, 1),
    { ...timeout(), stdout: JSON.stringify(clean) },
    { ...complete(), status: 2 },
    complete({ ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, critical: 1 } } }),
    complete({ ...clean, error: { code: "ETIMEDOUT" } }, 1),
  ])("does not retry invalid, authentication or ambiguous results: %#", result => {
    spawnMock.mockReturnValueOnce(result).mockReturnValueOnce(complete());
    expect(() => runDependencyAudit()).toThrow();
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("blocks a new advisory after transport recovery without trying to obtain a clean result", () => {
    const advisory = { name: "new-package", severity: "high", url: "https://example.invalid/new-advisory" };
    spawnMock.mockReturnValueOnce(timeout()).mockReturnValueOnce(complete({
      auditReportVersion: 2,
      vulnerabilities: { "new-package": { severity: "high", via: [advisory] } },
      metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1, total: 1 } },
    }, 1)).mockReturnValueOnce(complete());
    expect(() => runDependencyAudit()).toThrow(/Unreviewed/);
    expect(spawnMock).toHaveBeenCalledTimes(4);
  });

  it("does not contact the registry when backport integrity fails", () => {
    spawnMock.mockReset().mockReturnValueOnce({ status: 1 });
    expect(() => runDependencyAudit()).toThrow(/backport integrity/);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
