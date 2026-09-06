import { spawnSync } from "node:child_process";
import process from "node:process";

const includeBrowserTests = process.argv.includes("--with-e2e");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--with-e2e");

if (unknownArguments.length > 0) {
  console.error(`Unknown release-gate argument: ${unknownArguments.join(", ")}`);
  process.exit(2);
}

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  {
    label: "Repository patch integrity",
    executable: "git",
    arguments: ["diff", "--check"],
  },
  {
    label: "Unit and integration tests",
    executable: process.execPath,
    arguments: ["./node_modules/vitest/vitest.mjs", "run"],
  },
  {
    label: "Code-quality checks",
    executable: process.execPath,
    arguments: ["./node_modules/eslint/bin/eslint.js", "."],
  },
  {
    label: "TypeScript validation",
    executable: process.execPath,
    arguments: ["./node_modules/typescript/bin/tsc", "--noEmit"],
  },
  {
    label: "Native app TypeScript validation",
    executable: npmExecutable,
    arguments: ["run", "mobile:typecheck"],
  },
  {
    label: "Generated build cleanup",
    executable: npmExecutable,
    arguments: ["run", "clean"],
  },
  {
    label: "Production build",
    executable: npmExecutable,
    arguments: ["run", "build"],
  },
  {
    label: "Native iOS and Android bundle export",
    executable: npmExecutable,
    arguments: ["run", "mobile:export"],
  },
];

if (includeBrowserTests) {
  steps.push({
    label: "Mobile and desktop browser flows",
    executable: process.execPath,
    arguments: ["./node_modules/playwright/cli.js", "test"],
  });
}

const startedAt = Date.now();
console.log(`\nAlpha Traders release safety gate${includeBrowserTests ? " (including browser flows)" : ""}\n`);

for (const [index, step] of steps.entries()) {
  const stepStartedAt = Date.now();
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}\n`);

  const result = spawnSync(step.executable, step.arguments, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`\nRelease blocked: ${step.label} could not start (${result.error.message}).`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nRelease blocked: ${step.label} failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }

  const elapsedSeconds = ((Date.now() - stepStartedAt) / 1_000).toFixed(1);
  console.log(`\nPassed: ${step.label} (${elapsedSeconds}s)`);
}

const elapsedSeconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
console.log(`\nRelease safety gate passed in ${elapsedSeconds}s.\n`);
