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
  it("does nothing outside the installed app", async () => {
    expect(await requestAppRememberedLogin("load")).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
