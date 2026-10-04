import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }));
import { requestAppRememberedLogin, REMEMBERED_LOGIN_TIMEOUT_MS } from "@/lib/app-remembered-login";
import { handleRememberedLoginMessage, rememberedLoginReplyScript } from "../../apps/mobile/src/web/remembered-login-bridge";

const originalLocation = window.location;
const url = "https://www.alphatraders.co.il/en/login?redirectTo=%2Fen";
const credentials = { email: "buyer@example.test", password: " secret-\"password\"\n" };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  Object.defineProperty(window, "location", { configurable: true, value: { href: url } });
});
afterEach(() => {
  vi.useRealTimers(); delete window.ReactNativeWebView; delete window.__alphaRememberedLoginRequestId;
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("web to native remembered login protocol", () => {
  it("round-trips save, load and clear through the actual native handler and guarded reply", async () => {
    mocks.load.mockResolvedValue(credentials);
    const delivered: Promise<void>[] = [];
    window.ReactNativeWebView = { postMessage: (raw) => {
      delivered.push(handleRememberedLoginMessage(url, raw, mocks).then(response => {
        if (response) new Function("window", rememberedLoginReplyScript(url, response)!)(window);
      }));
    } };
    expect(await requestAppRememberedLogin("save", credentials)).toMatchObject({ status: "ok" });
    expect(mocks.save).toHaveBeenCalledWith(credentials);
    expect((await requestAppRememberedLogin("load"))?.credentials).toEqual(credentials);
    expect(await requestAppRememberedLogin("clear")).toMatchObject({ status: "ok" });
    expect(mocks.clear).toHaveBeenCalledOnce();
    await Promise.all(delivered);
    expect(window.__alphaRememberedLoginRequestId).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores mismatched responses and times out cleanly in an older app", async () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };
    const settled = vi.fn();
    const pending = requestAppRememberedLogin("load").then(settled);
    window.dispatchEvent(new CustomEvent("alpha-native-remembered-login", { detail: {
      type: "alpha.native.remembered-login", version: 1, requestId: "different-request-id", status: "ok", credentials,
    } }));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REMEMBERED_LOGIN_TIMEOUT_MS);
    await pending;
    expect(settled).toHaveBeenCalledWith(null);
    expect(window.__alphaRememberedLoginRequestId).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a pending request immediately and removes its timeout", async () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };
    const controller = new AbortController();
    const pending = requestAppRememberedLogin("load", undefined, controller.signal);
    expect(window.__alphaRememberedLoginRequestId).toBeDefined();
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect(await pending).toBeNull();
    expect(window.__alphaRememberedLoginRequestId).toBeUndefined();
  });
  it("does not send credentials for a request that was already cancelled", async () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };
    const controller = new AbortController();
    controller.abort();
    const pending = requestAppRememberedLogin("save", credentials, controller.signal);
    expect(postMessage).not.toHaveBeenCalled();
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("finishes a timeout on the originating window after the global document is torn down", async () => {
    const requestWindow = window;
    requestWindow.ReactNativeWebView = { postMessage: vi.fn() };
    const pending = requestAppRememberedLogin("load");
    try {
      vi.stubGlobal("window", undefined);
      await vi.advanceTimersByTimeAsync(REMEMBERED_LOGIN_TIMEOUT_MS);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await pending).toBeNull();
    expect(requestWindow.__alphaRememberedLoginRequestId).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does nothing outside the installed app", async () => {
    expect(await requestAppRememberedLogin("load")).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
