// @vitest-environment node
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

const gateSource = readFileSync("scripts/release-safety-gate.mjs", "utf8");
const wiseConfig = "--config=playwright.wise-draft.config.ts";

class GateExit extends Error {
  constructor(readonly code: number) { super(`release gate exited ${code}`); }
}

function runGate(arguments_: string[], wiseStatus = 0) {
  const spawn = vi.fn((...call: [string, string[], { env: Record<string, string> }]) => ({ status: call[1].includes(wiseConfig) ? wiseStatus : 0 }));
  const processStub = {
    argv: ["node", "scripts/release-safety-gate.mjs", ...arguments_],
    env: {}, execPath: "node", cwd: () => "/isolated-checkout",
    exit: (code: number) => { throw new GateExit(code); },
  };
  // Execute the real sequential gate with inert process/command boundaries.
  // No build, browser, package audit or network request is launched by this test.
  const run = new Function("spawnSync", "process", "getNpmCommand", "console", gateSource.replace(/^import .+;\r?\n/gm, ""));
  return { spawn, run: () => run(spawn, processStub, () => ({ command: "npm", prefixArgs: [] }), { log: vi.fn(), error: vi.fn() }) };
}

describe("release acceptance coverage", () => {
  it("waits for and requires success from every independent Reliability Shield job", () => {
    const workflow = parse(readFileSync(".github/workflows/reliability-shield.yml", "utf8"));
    const acceptance = workflow.jobs["release-acceptance"];
    const jobs = Object.keys(workflow.jobs).filter(job => job !== "release-acceptance");
    expect([...acceptance.needs].sort()).toEqual(jobs.sort());
    expect(acceptance.if).toBe("always()");
    const step = acceptance.steps.find((entry: { env?: Record<string, string> }) => entry.env);
    for (const job of jobs) {
      const variable = Object.entries(step.env as Record<string, string>)
        .find(([, expression]) => expression === `\${{ needs.${job}.result }}`)?.[0];
      expect(variable, `${job} needs a checked result`).toBeTruthy();
      expect(step.run.split(/\r?\n/).map((line: string) => line.trim()))
        .toContain(`test "$${variable}" = success`);
    }
  });

  it("runs Wise against the compiled isolated server when full browser verification is requested", () => {
    const gate = runGate(["--with-e2e"]);
    gate.run();
    const wise = gate.spawn.mock.calls.filter(([, args]) => args.includes(wiseConfig));
    expect(wise).toHaveLength(1);
    expect(wise[0][0]).toBe("node");
    expect(wise[0][1]).toEqual(["./node_modules/playwright/cli.js", "test", wiseConfig]);
    expect(wise[0][2].env)
      .toMatchObject({ CI: "1", WISE_OFFLINE_PRODUCTION: "1" });
  });

  it("does not launch browsers during the default unit/build gate", () => {
    const gate = runGate([]);
    gate.run();
    expect(gate.spawn.mock.calls.some(([, args]) => args.includes(wiseConfig))).toBe(false);
  });

  it.each([1, 2])("stops the release before later browser steps when Wise exits %i", status => {
    const gate = runGate(["--with-e2e"], status);
    expect(gate.run).toThrow(`release gate exited ${status}`);
    expect(gate.spawn.mock.calls.at(-1)?.[1]).toContain(wiseConfig);
  });
});
