"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Plain CommonJS entrypoint runs directly under the pinned Node image. */

const { createServer } = require("node:http");
const { join } = require("node:path");
const { assertContainerNodeRuntime, resolveContainerOrigin, validateContainerRequest, containerCanonicalRedirect } = require("./container-origin.cjs");

async function startContainerServer() {
  assertContainerNodeRuntime();
  const expected = resolveContainerOrigin();
  const dir = join(__dirname, "..");
  process.chdir(dir);
  const conf = require(join(dir, "next.config.js"));
  const next = require("next");
  let handle;
  const server = createServer((request, response) => {
    const canonicalRedirect = containerCanonicalRedirect(request, expected);
    const denied = validateContainerRequest(request, expected);
    if (denied) {
      response.writeHead(denied, { "Content-Type": "application/json", "Cache-Control": "private, no-store", Connection: "close" });
      response.end(JSON.stringify({ error: "Invalid request origin." }));
      return;
    }
    if (canonicalRedirect) {
      response.writeHead(308, { Location: canonicalRedirect, "Cache-Control": "private, no-store" });
      response.end();
      return;
    }
    Promise.resolve(handle(request, response)).catch(() => {
      console.error("Container request could not be completed.");
      if (!response.headersSent) response.writeHead(500, { "Cache-Control": "private, no-store" });
      response.end();
    });
  });
  // Middleware and Route Handlers must see the logical public origin. The HTTP
  // listener is deliberately separate from Next's public hostname/port options.
  const app = next({ dev: false, dir, conf, hostname: expected.hostname, port: expected.port, httpServer: server });
  await app.prepare();
  handle = app.getRequestHandler();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8080, "0.0.0.0", resolve);
  });
  console.log("Container Next server ready.");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25_000);
    deadline.unref();
    await new Promise(resolve => {
      server.close(resolve);
      server.closeIdleConnections();
    });
    await app.close(); // Next's internal awaiter drains pending after() callbacks.
    clearTimeout(deadline);
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
  return { server, app, stop };
}

if (require.main === module) {
  startContainerServer().catch(() => {
    console.error("Container Next server startup failed.");
    process.exitCode = 1;
  });
}
module.exports = { startContainerServer };
