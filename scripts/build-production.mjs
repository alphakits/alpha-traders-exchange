import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const nextBuildEntry = path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");
const fsRetryPreload = path.join(repositoryRoot, "scripts", "next-build-fs-retry.cjs");
const buildOutputDirectory = path.join(repositoryRoot, ".next");
const MAX_CAPTURED_OUTPUT = 128 * 1024;
const MAX_BUILD_ATTEMPTS = 2;

export function isNextExportCleanupRace(output) {
  const normalizedOutput = String(output).replaceAll("\\", "/");
  return /ENOTEMPTY:[^\r\n]*rmdir[^\r\n]*\.next\/export(?:\/|['"]|$)/i.test(normalizedOutput);
}

function runNextBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--require", fsRetryPreload, nextBuildEntry, "build"],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );

    let capturedOutput = "";
    const forward = (destination, chunk) => {
      destination.write(chunk);
      capturedOutput = `${capturedOutput}${chunk.toString("utf8")}`.slice(-MAX_CAPTURED_OUTPUT);
    };

    child.stdout.on("data", (chunk) => forward(process.stdout, chunk));
    child.stderr.on("data", (chunk) => forward(process.stderr, chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ capturedOutput, code, signal }));
  });
}

async function clearGeneratedBuildOutput() {
  if (path.dirname(buildOutputDirectory) !== repositoryRoot) {
    throw new Error("Refusing to clean an unexpected production build directory.");
  }

  await rm(buildOutputDirectory, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}

export async function runProductionBuild() {
  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt += 1) {
    const result = await runNextBuild();

    if (result.code === 0) {
      return 0;
    }

    const canRetry =
      attempt < MAX_BUILD_ATTEMPTS && isNextExportCleanupRace(result.capturedOutput);

    if (!canRetry) {
      if (result.signal) {
        console.error(`Production build stopped by signal ${result.signal}.`);
      }
      return result.code ?? 1;
    }

    console.warn(
      "Retrying the production build once after Next's temporary export-directory cleanup race.",
    );
    await clearGeneratedBuildOutput();
  }

  return 1;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;

if (invokedAsScript) {
  process.exitCode = await runProductionBuild();
}
