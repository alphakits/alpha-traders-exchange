import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Read-only retrieval of one existing, account-owned guest navigation audit.
// Keep fresh signed URLs only in memory. Never emit credentials, raw CLI JSON,
// signed links, or the video recordings into public GitHub logs/artifacts.
const workflowId = "01a1838f-99e4-778f-a607-19bed2b345f8";
const projectId = "e5dbc3ba-25fb-4373-8ded-c8c80cadc147";
const sourceCommit = "eae628c49a8f8d056c55c90f0134cafbc45a602a";
const outputDir = path.resolve("native-failure-evidence");
const maxBytes = 20 * 1024 * 1024;
const expectedJobs = new Set(["android_navigation", "ios_navigation", "legacy_android_recovery"]);

const view = spawnSync("eas", ["workflow:view", workflowId, "--json", "--non-interactive"], {
  cwd: path.resolve("apps/mobile"),
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
  timeout: 90_000,
});
if (view.error || view.status !== 0) {
  throw new Error("Could not read the existing Expo workflow. No new build or test was started.");
}
let result;
try { result = JSON.parse(view.stdout); } catch {
  throw new Error("Expo returned an invalid workflow response.");
}
if (result.id !== workflowId || result.workflow?.app?.id !== projectId
  || result.workflow.app.ownerAccount?.name !== "alpha-traders"
  || result.gitCommitHash !== sourceCommit || !Array.isArray(result.jobs)) {
  throw new Error("Workflow ownership or source provenance does not match the requested audit.");
}

await mkdir(outputDir, { recursive: true });
const manifest = {
  retrievedAt: new Date().toISOString(), workflowId, projectId, sourceCommit,
  status: result.status, originGitHubRun: "40736072495", jobs: [],
};
let downloadFailures = 0;
for (const job of result.jobs.filter(job => expectedJobs.has(job.key))) {
  const jobRecord = { key: job.key, id: job.id, status: job.status, artifacts: [] };
  manifest.jobs.push(jobRecord);
  const artifacts = job.turtleJobRun?.artifacts ?? [];
  for (const [index, artifact] of artifacts.entries()) {
    const filename = artifact.filename;
    const selected = typeof filename === "string" && (
      (artifact.name?.startsWith("Failure Screenshot:") && filename.endsWith(".png"))
      || (artifact.name === "Maestro Test Results" && filename === "artifacts.tar.gz")
      || /^(?:android|ios)-maestro-junit\.xml$/.test(filename)
    );
    if (!selected || !Number.isSafeInteger(artifact.fileSizeBytes)
      || artifact.fileSizeBytes <= 0 || artifact.fileSizeBytes > maxBytes) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("Artifact filename is invalid.");
    const url = new URL(artifact.downloadUrl);
    if (url.protocol !== "https:" || url.hostname !== "wf-artifacts.eascdn.net"
      || !url.pathname.startsWith(`/artifacts/${projectId}/${job.id}/`)) {
      throw new Error("Artifact destination is outside the expected Expo workflow.");
    }
    const savedName = `${job.key}-${index}-${filename}`;
    const record = { id: artifact.id, name: artifact.name, filename: savedName,
      expectedBytes: artifact.fileSizeBytes, status: "pending" };
    jobRecord.artifacts.push(record);
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) throw new Error("Artifact exceeds size limit.");
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error("Artifact exceeds size limit.");
        chunks.push(chunk);
      }
      if (size !== artifact.fileSizeBytes) throw new Error("Artifact byte count differs from Expo metadata.");
      const bytes = Buffer.concat(chunks);
      if (filename.endsWith(".png") && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        throw new Error("Screenshot is not a PNG image.");
      }
      if (filename.endsWith(".tar.gz") && (bytes[0] !== 31 || bytes[1] !== 139)) {
        throw new Error("Trace archive is not gzip data.");
      }
      await writeFile(path.join(outputDir, savedName), bytes);
      record.status = "downloaded";
      record.bytes = size;
      record.sha256 = createHash("sha256").update(bytes).digest("hex");
      console.log(`${job.key}: saved ${savedName} (${size} bytes)`);
    } catch {
      downloadFailures += 1;
      record.status = "download_failed";
      console.error(`${job.key}: failed to retrieve artifact ${artifact.id}; no signed URL logged.`);
    }
  }
}
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const downloaded = manifest.jobs.flatMap(job => job.artifacts).filter(item => item.status === "downloaded");
const screenshotCount = downloaded.filter(item => item.filename.endsWith(".png")).length;
const androidTrace = downloaded.some(item => item.filename.startsWith("android_navigation-") && item.filename.endsWith(".tar.gz"));
if (downloadFailures || manifest.jobs.length !== expectedJobs.size || screenshotCount !== 4 || !androidTrace) {
  throw new Error("Required native evidence was not completely retrieved; inspect the sanitized manifest.");
}
console.log(`Retrieved ${downloaded.length} artifacts from the existing failed run. No tests were rerun.`);

