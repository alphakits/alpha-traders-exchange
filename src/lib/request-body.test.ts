import { describe, expect, it, vi } from "vitest";
import { readLimitedRequestText, RequestBodyTooLargeError } from "./request-body";
import { NextRequest } from "next/server";
import { readMobileJsonBody } from "./mobile-api";

describe("bounded request body reader", () => {
  it("applies the mobile JSON limit even when Content-Length is missing", async () => {
    const request = new NextRequest("https://example.com/api/mobile/v1/auth/login", {
      method: "POST", body: JSON.stringify({ password: "p".repeat(20_000) }),
    });
    expect(await readMobileJsonBody(request)).toBeNull();
    expect(await readMobileJsonBody(new NextRequest("https://example.com", {
      method: "POST", body: JSON.stringify({ email: "test@example.com" }),
    }))).toEqual({ email: "test@example.com" });
  });
  it("decodes Unicode characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode("قبل😀after");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const request = new Request("https://example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readLimitedRequestText(request, bytes.length)).toBe("قبل😀after");
  });

  it("cancels an unbounded stream when actual bytes exceed the limit", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(32)); }, cancel });
    const request = new Request("https://example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readLimitedRequestText(request, 50)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a declared oversized body without reading it", async () => {
    const request = new Request("https://example.com", { method: "POST", headers: { "Content-Length": "1000" }, body: "small" });
    await expect(readLimitedRequestText(request, 50)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(request.bodyUsed).toBe(false);
  });
});
