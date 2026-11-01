// @vitest-environment node
import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Transform } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, expect, it } from "vitest";

type SseEvent = { type: string; options: { data: string; lastEventId?: string; origin?: string } };
type ParserConstructor = new (options: {
  maxEventSize: number;
  eventSourceSettings?: { origin: string; lastEventId: string };
}) => Transform;

const rootRequire = createRequire(import.meta.url);
const consumers = ["discord.js", "@discordjs/rest", "jsdom"] as const;

describe.each(consumers)("Undici EventSource security through %s", (consumer) => {
  const dependencyRequire = createRequire(rootRequire.resolve(consumer));
  const { EventSourceStream } = dependencyRequire("undici/lib/web/eventsource/eventsource-stream.js") as {
    EventSourceStream: ParserConstructor;
  };

  async function parse(chunks: Buffer[], maxEventSize: number) {
    const events: SseEvent[] = [];
    const parser = new EventSourceStream({
      maxEventSize,
      eventSourceSettings: { origin: "https://fixture.invalid", lastEventId: "" },
    });
    parser.on("data", (event: SseEvent) => events.push(event));
    const result = finished(parser).then(() => null, (error: unknown) => error);
    for (const chunk of chunks) {
      if (parser.destroyed) break;
      parser.write(chunk);
    }
    if (!parser.destroyed) parser.end();
    const error = await result;
    return { events, error };
  }

  it("rejects excessive tiny data fields even below the byte budget", async () => {
    const result = await parse([Buffer.from("data:\n".repeat(1025))], 65536);
    expect(result.events).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/EventSource message size exceeded/);
  });

  it("rejects excessive fragments of an unfinished line below the byte budget", async () => {
    const result = await parse(Array.from({ length: 1025 }, () => Buffer.from("x")), 65536);
    expect(result.events).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/EventSource message size exceeded/);
  });

  it("rejects an oversized unfinished line without waiting for a newline", async () => {
    const result = await parse([Buffer.from("data: " + "x".repeat(80))], 64);
    expect(result.events).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("counts event metadata together with retained data", async () => {
    const message = "event: " + "e".repeat(20) + "\nid: " + "i".repeat(20) + "\ndata: " + "d".repeat(30) + "\n";
    const result = await parse([Buffer.from(message)], 64);
    expect(result.events).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("preserves split UTF-8, event identity and independent event budgets", async () => {
    const bytes = Buffer.from("id: first\nevent: update\ndata: " + "a".repeat(40) + "\n\nid: second\ndata: مرحبا\n\n");
    const result = await parse(Array.from(bytes, (byte) => Buffer.from([byte])), 64);
    expect(result.error).toBeNull();
    expect(result.events).toEqual([
      { type: "update", options: { data: "a".repeat(40), lastEventId: "first", origin: "https://fixture.invalid" } },
      { type: "message", options: { data: "مرحبا", lastEventId: "second", origin: "https://fixture.invalid" } },
    ]);
  });

  it("keeps the consumer's HTTP request path working", async () => {
    const { request } = dependencyRequire("undici") as typeof import("undici");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await request(`http://127.0.0.1:${port}/health`);
      expect(response.statusCode).toBe(200);
      expect(await response.body.json()).toEqual({ ok: true });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
