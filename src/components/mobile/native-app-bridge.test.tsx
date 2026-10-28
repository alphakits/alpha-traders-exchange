import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: { id: "signed-in-user" }, isResolving: false }),
}));
vi.mock("@/lib/native-app-bridge", () => ({ postToNativeApp: mocks.post }));

import { NativeAppBridge } from "./native-app-bridge";

describe("native session reset before logout navigation", () => {
  beforeEach(() => { mocks.post.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("sends English logout synchronously without waiting for a React render", () => {
    render(<NativeAppBridge locale="ar" />);
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ authenticated: true, locale: "ar" }));
    mocks.post.mockClear();
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith({
      type: "alpha.web.session", version: 1, authenticated: false, locale: "en",
    });
  });

  it("removes the logout listener when the document bridge unmounts", () => {
    const page = render(<NativeAppBridge locale="ar" />);
    page.unmount();
    mocks.post.mockClear();
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

it("ignores delayed native status from another account", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<NativeAppBridge locale="en" />);
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "alpha.native.push-registration", version: 1, status: "registered", userId: "old-user", installationId: "device", expoPushToken: "ExponentPushToken[test]", platform: "ios", appVersion: "1.2.0", locale: "en" }) })); });
  expect(fetcher).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals();
});

it("does not report a revoked permission as on when persistence finishes late", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(() => new Promise<Response>(r => { resolve = r; }));
  vi.stubGlobal("fetch", fetcher);
  const states: string[] = [];
  const listener = (event: Event) => states.push((event as CustomEvent).detail.state);
  window.addEventListener("alpha-notification-push-state", listener);
  render(<NativeAppBridge locale="en" />);
  const send = (status: object) => window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "alpha.native.push-registration", version: 1, userId: "signed-in-user", ...status }) }));
  await act(async () => {
    send({ status: "registered", installationId: "device", expoPushToken: "ExponentPushToken[test]", platform: "ios", appVersion: "1.2.0", locale: "en" });
  });
  await act(async () => {
    send({ status: "denied" });
    resolve(new Response("{}", { status: 200 }));
  });
  expect(states).toEqual(["blocked"]);
  expect(fetcher).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: expect.stringContaining('"expectedUserId":"signed-in-user"') }));
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  window.removeEventListener("alpha-notification-push-state", listener);
  cleanup(); vi.unstubAllGlobals();
});


describe("native registration replacement ordering", () => {
  const sendRegistration = (token: string, locale: "en" | "ar" = "en") => {
    window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
      type: "alpha.native.push-registration", version: 1, status: "registered",
      userId: "signed-in-user", installationId: "device",
      expoPushToken: token, platform: "ios", appVersion: "1.2.0", locale,
    }) }));
  };

  beforeEach(() => { mocks.post.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each([200, 400])("serializes replacements and ignores superseded HTTP %s results", async (status) => {
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const states: string[] = [];
    const listener = (event: Event) => states.push((event as CustomEvent).detail.state);
    window.addEventListener("alpha-notification-push-state", listener);
    try {
      render(<NativeAppBridge locale="en" />);
      await act(async () => { sendRegistration("ExponentPushToken[old-token]"); });
      await act(async () => {
        sendRegistration("ExponentPushToken[intermediate-token]");
        sendRegistration("ExponentPushToken[new-token]", "ar");
      });
      // The first server request must settle before any replacement can write.
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await act(async () => { resolveFirst(new Response("{}", { status })); });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).expoPushToken))
        .toEqual(["ExponentPushToken[old-token]", "ExponentPushToken[new-token]"]);
      expect(states).toEqual(["on"]);
      expect(mocks.post.mock.calls.map(([message]) => message).filter(message => message.type === "alpha.web.push-registration"))
        .toEqual([expect.objectContaining({ status: "registered", locale: "ar" })]);
    } finally {
      window.removeEventListener("alpha-notification-push-state", listener);
    }
  });

  it("does not retry an obsolete token after a refresh arrives during backoff", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<NativeAppBridge locale="en" />);
    await act(async () => { sendRegistration("ExponentPushToken[old-token]"); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { sendRegistration("ExponentPushToken[new-token]", "ar"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).expoPushToken))
      .toEqual(["ExponentPushToken[old-token]", "ExponentPushToken[new-token]"]);
    expect(mocks.post.mock.calls.map(([message]) => message).filter(message => message.type === "alpha.web.push-registration"))
      .toEqual([expect.objectContaining({ status: "registered", locale: "ar" })]);
  });
});
