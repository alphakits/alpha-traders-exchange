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
    send({ status: "denied" });
    resolve(new Response("{}", { status: 200 }));
  });
  expect(states).toEqual(["blocked"]);
  expect(fetcher).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: expect.stringContaining('"expectedUserId":"signed-in-user"') }));
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  window.removeEventListener("alpha-notification-push-state", listener);
  cleanup(); vi.unstubAllGlobals();
});
