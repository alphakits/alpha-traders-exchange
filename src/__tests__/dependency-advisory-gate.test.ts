import { describe, expect, it } from "vitest";
import { assessDependencyAudit } from "../../scripts/check-dependency-advisories.mjs";

type Severity = "info" | "low" | "moderate" | "high" | "critical";
type Advisory = { name: string; severity: Severity; url: string };
type Entry = { severity: Severity; via: (string | Advisory)[] };
const guarded = { backportsVerified: true };
const forge: Advisory = { name: "node-forge", severity: "high", url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv" };
const braces: Advisory = { name: "braces", severity: "high", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" };
function report(vulnerabilities: Record<string, Entry> = {}) {
  const totals = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: Object.keys(vulnerabilities).length };
  for (const entry of Object.values(vulnerabilities)) totals[entry.severity]++;
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: totals } };
}

describe("dependency advisory release gate", () => {
  it("accepts a complete clean report", () => {
    expect(assessDependencyAudit(report()).blockers).toEqual([]);
  });
  it("blocks the newly published critical shell-quote advisory", () => {
    const advisory: Advisory = { name: "shell-quote", severity: "critical", url: "https://github.com/advisories/GHSA-pqg4-j6r4-53mv" };
    expect(assessDependencyAudit(report({ "shell-quote": { severity: "critical", via: [advisory] } }), guarded).blockers).toHaveLength(1);
  });
  it("blocks a new high-severity image-processing advisory", () => {
    const advisory: Advisory = { name: "sharp", severity: "high", url: "https://github.com/advisories/GHSA-wq5f-xc86-pv6w" };
    expect(assessDependencyAudit(report({ sharp: { severity: "high", via: [advisory] } }), guarded).blockers).toHaveLength(1);
  });
  it("requires source-integrity verification before accepting a backport", () => {
    const data = report({ "node-forge": { severity: "high", via: [forge] } });
    expect(assessDependencyAudit(data).blockers).toHaveLength(1);
    expect(assessDependencyAudit(data, guarded).guarded).toHaveLength(1);
  });
  it("resolves cyclic dependency graphs while retaining the guarded root", () => {
    const data = report({ metro: { severity: "high", via: ["config", "braces"] }, config: { severity: "high", via: ["metro"] }, braces: { severity: "high", via: [braces] } });
    expect(assessDependencyAudit(data, guarded)).toMatchObject({ blockers: [], guarded: ["braces: " + braces.url] });
  });
  it("does not allow a new advisory on an already guarded package", () => {
    const data = report({ "node-forge": { severity: "high", via: [forge, { ...forge, url: "https://github.com/advisories/GHSA-new-advisory" }] } });
    expect(assessDependencyAudit(data, guarded).blockers).toHaveLength(1);
  });
  it("blocks a changed severity or package identity on a guarded advisory", () => {
    expect(assessDependencyAudit(report({ "node-forge": { severity: "critical", via: [{ ...forge, severity: "critical" }] } }), guarded).blockers).toHaveLength(1);
    expect(assessDependencyAudit(report({ different: { severity: "high", via: [{ ...forge, name: "different" }] } }), guarded).blockers).toHaveLength(1);
  });
  it("fails closed on registry errors, malformed reports and inconsistent totals", () => {
    expect(() => assessDependencyAudit({ error: { message: "registry unavailable" } })).toThrow();
    expect(() => assessDependencyAudit({ ...report(), auditReportVersion: 1 })).toThrow();
    const data = report(); data.metadata.vulnerabilities.critical = 1;
    expect(() => assessDependencyAudit(data)).toThrow(/inconsistent/);
  });
  it("fails closed on missing or unresolvable transitive advisory details", () => {
    expect(() => assessDependencyAudit(report({ parent: { severity: "high", via: ["missing"] } }), guarded)).toThrow(/missing advisory/);
    expect(() => assessDependencyAudit(report({ first: { severity: "high", via: ["second"] }, second: { severity: "high", via: ["first"] } }), guarded)).toThrow(/cannot resolve/);
  });
  it("blocks unreviewed moderate findings while keeping them visible", () => {
    const data = report({ decoder: { severity: "moderate", via: [{ name: "decoder", severity: "moderate", url: "https://example.invalid/advisory" }] } });
    expect(assessDependencyAudit(data, guarded).blockers).toHaveLength(1);
    expect(assessDependencyAudit(data, guarded)).toMatchObject({ moderate: ["decoder"], totals: { moderate: 1 } });
  });
  it("requires the exact verified decoder backport for its moderate advisory chain", () => {
    const decoder: Advisory = { name: "decode-uri-component", severity: "moderate", url: "https://github.com/advisories/GHSA-vcc3-ghjq-m6fr" };
    const data = report({ "decode-uri-component": { severity: "moderate", via: [decoder] }, "query-string": { severity: "moderate", via: ["decode-uri-component"] } });
    expect(assessDependencyAudit(data).blockers).toHaveLength(2);
    expect(assessDependencyAudit(data, guarded)).toMatchObject({ blockers: [], guarded: ["decode-uri-component: " + decoder.url] });
    expect(assessDependencyAudit(report({ decoder: { severity: "high", via: [{ ...decoder, severity: "high" }] } }), guarded).blockers).toHaveLength(1);
  });
  it("blocks the Next.js cache advisories until the upstream fixed version is installed", () => {
    const next: Advisory = { name: "next", severity: "moderate", url: "https://github.com/advisories/GHSA-4jqv-mc3x-m676" };
    expect(assessDependencyAudit(report({ next: { severity: "moderate", via: [next] } }), guarded).blockers).toHaveLength(1);
  });
});
