import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { realpathSync } from "node:fs";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run against the separate dependency installation copied into the worker image.
// Resolving the root web workspace would miss the production worker's lockfile.
const workerRequire = createRequire(import.meta.url);
const workerModules = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "node_modules")) + sep;
const consumers = ["discord.js", "@discordjs/rest"];
const vercelRequire = createRequire(workerRequire.resolve("@vercel/cli-config"));
const { z } = vercelRequire("zod");

test("worker consumers resolve patched dependencies inside the worker installation", () => {
  for (const consumer of consumers) {
    const resolver = createRequire(workerRequire.resolve(consumer));
    assert.ok(realpathSync(resolver.resolve("undici")).startsWith(workerModules));
    assert.equal(resolver("undici/package.json").version, "6.29.1");
  }
  assert.ok(realpathSync(vercelRequire.resolve("zod")).startsWith(workerModules));
  assert.equal(vercelRequire("zod/package.json").version, "4.6.6");
});

for (const consumer of consumers) {
  const resolver = createRequire(workerRequire.resolve(consumer));
  const { EventSourceStream } = resolver("undici/lib/web/eventsource/eventsource-stream.js");
  async function parse(chunks, maxEventSize) {
    const events = [];
    const parser = new EventSourceStream({ maxEventSize,
      eventSourceSettings: { origin: "https://fixture.invalid", lastEventId: "" } });
    parser.on("data", event => events.push(event));
    const result = finished(parser).then(() => null, error => error);
    for (const chunk of chunks) {
      if (parser.destroyed) break;
      parser.write(chunk);
    }
    if (!parser.destroyed) parser.end();
    return { events, error: await result };
  }
  const rejected = [
    ["tiny data fields", [Buffer.from("data:\n".repeat(1025))], 65536],
    ["unfinished fragments", Array.from({ length: 1025 }, () => Buffer.from("x")), 65536],
    ["oversized unfinished line", [Buffer.from("data: " + "x".repeat(80))], 64],
    ["combined metadata and data", [Buffer.from("event: " + "e".repeat(20) + "\nid: " + "i".repeat(20) + "\ndata: " + "d".repeat(30) + "\n")], 64],
  ];
  for (const [name, chunks, limit] of rejected) {
    test(`${consumer}: bounds ${name}`, async () => {
      const result = await parse(chunks, limit);
      assert.deepEqual(result.events, []);
      assert.ok(result.error instanceof Error);
    });
  }
  test(`${consumer}: preserves split UTF-8, identity and independent event budgets`, async () => {
    const bytes = Buffer.from("id: first\nevent: update\ndata: " + "a".repeat(40) + "\n\nid: second\ndata: مرحبا\n\n");
    const result = await parse(Array.from(bytes, byte => Buffer.from([byte])), 64);
    assert.equal(result.error, null);
    assert.deepEqual(result.events, [
      { type: "update", options: { data: "a".repeat(40), lastEventId: "first", origin: "https://fixture.invalid" } },
      { type: "message", options: { data: "مرحبا", lastEventId: "second", origin: "https://fixture.invalid" } },
    ]);
  });
  test(`${consumer}: HTTP requests remain compatible`, async () => {
    const { request } = resolver("undici");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await request(`http://127.0.0.1:${server.address().port}/health`);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(await response.body.json(), { ok: true });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

for (const bound of ["max", "length"]) {
  test(`worker Zod: rejects oversized arrays before element traversal (${bound})`, () => {
    let visited = 0;
    const array = z.array(z.string().superRefine(() => { visited++; }))[bound](2);
    const result = array.safeParse(Array(10000).fill("synthetic"));
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].code, "too_big");
    assert.equal(visited, 0);
    assert.deepEqual(array.parse(["one", "two"]), ["one", "two"]);
    assert.equal(visited, 2);
  });
}
test("worker Zod: rejects oversized maps and sets before element traversal", () => {
  let visited = 0;
  const item = z.string().superRefine(() => { visited++; });
  assert.equal(z.set(item).max(1).safeParse(new Set(["a", "b"])).success, false);
  assert.equal(z.map(item, item).max(1).safeParse(new Map([["a", "one"], ["b", "two"]])).success, false);
  assert.equal(visited, 0);
});
test("worker Zod: preserves ordinary strict configuration validation", () => {
  const schema = z.object({ enabled: z.boolean(), label: z.string().min(1) }).strict();
  assert.deepEqual(schema.parse({ enabled: true, label: "synthetic" }), { enabled: true, label: "synthetic" });
  assert.equal(schema.safeParse({ enabled: "true", label: "synthetic" }).success, false);
  assert.equal(schema.safeParse({ enabled: true, label: "" }).success, false);
  assert.equal(schema.safeParse({ enabled: true, label: "synthetic", extra: true }).success, false);
});
