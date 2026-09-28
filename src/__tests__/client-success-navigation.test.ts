// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { consumeActionResult, navigateAfterSuccess, navigateOrRevealResult } from "@/lib/client-success-navigation";

describe("client success navigation", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/en/usdt-exchange");
  });

  it("reveals and focuses a same-page result without changing locale path", async () => {
    window.history.replaceState({}, "", "/en/usdt-exchange");
    const router = { push: vi.fn() } as unknown as { push: ReturnType<typeof vi.fn> };
    const result = document.createElement("div");
    result.id = "listing-publish-result";
    result.tabIndex = -1;
    const scrollIntoView = vi.fn();
    Object.defineProperty(result, "scrollIntoView", { value: scrollIntoView });
    document.body.append(result);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    navigateOrRevealResult(router as unknown as AppRouterInstance, "/usdt-exchange#listing-publish-result", "listing-publish-result");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/en/usdt-exchange");
    expect(window.location.hash).toBe("#listing-publish-result");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(result);
  });

  it("prioritizes the server result after a same-room action", async () => {
    window.history.replaceState({}, "", "/en/trade-room/purchase-123");
    const router = { push: vi.fn() } as unknown as { push: ReturnType<typeof vi.fn> };
    const result = document.createElement("div");
    result.id = "trade-action-result";
    result.tabIndex = -1;
    const resultScroll = vi.fn();
    Object.defineProperty(result, "scrollIntoView", { value: resultScroll });
    document.body.append(result);
    const action = document.createElement("div");
    action.id = "action-required";
    action.tabIndex = -1;
    const actionScroll = vi.fn();
    Object.defineProperty(action, "scrollIntoView", { value: actionScroll });
    document.body.append(action);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    navigateOrRevealResult(router as unknown as AppRouterInstance, "/trade-room/purchase-123?action=confirm-money-received#action-required", "trade-action-result");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.push).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#action-required");
    expect(resultScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(actionScroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(result);
  });

  it("lets shared feedback own scrolling without a competing second reveal", () => {
    window.history.replaceState({}, "", "/en/trade-room/purchase-123");
    const result = document.createElement("div");
    result.id = "trade-action-result";
    result.dataset.actionFeedback = "";
    const scrollIntoView = vi.fn();
    Object.defineProperty(result, "scrollIntoView", { value: scrollIntoView });
    document.body.append(result);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    navigateOrRevealResult({ push: vi.fn() } as unknown as AppRouterInstance, "/trade-room/purchase-123#action-required", result.id);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("carries a confirmed response to its destination once, across locale prefixes", () => {
    const router = { push: vi.fn() } as unknown as AppRouterInstance;
    navigateAfterSuccess(router, "/trade-room/purchase-123", "Request accepted.");
    expect(consumeActionResult("/en/dashboard")).toBeNull();
    expect(consumeActionResult("/en/trade-room/purchase-123")).toBe("Request accepted.");
    expect(consumeActionResult("/en/trade-room/purchase-123")).toBeNull();
  });

  it("does not replay an expired action result", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    navigateAfterSuccess({ push: vi.fn() } as unknown as AppRouterInstance, "/trade-room/purchase-123", "Request accepted.");
    now.mockReturnValue(62_000);
    expect(consumeActionResult("/trade-room/purchase-123")).toBeNull();
  });

  it.each(["/en", "/ar", "/en/", "/ar/"])("delivers home-page feedback at %s", (pathname) => {
    navigateAfterSuccess({ push: vi.fn() } as unknown as AppRouterInstance, "/", "Saved successfully.");
    expect(consumeActionResult(pathname)).toBe("Saved successfully.");
  });

  it.each([
    "javascript:alert(1)", "https://example.test/trade-room/123",
    "//example.test/trade-room/123", "/\\example.test/trade-room/123",
    "https://[invalid", "/trade-room/%E0%A4%A",
  ])("rejects an unsafe or malformed action destination: %s", (destination) => {
    const router = { push: vi.fn() } as unknown as AppRouterInstance;
    const location = window.location.href;
    expect(navigateAfterSuccess(router, destination, "Saved successfully.")).toBe(false);
    expect(navigateOrRevealResult(router, destination, "trade-action-result")).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(window.location.href).toBe(location);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("navigates when the canonical result belongs to another context", () => {
    const router = { push: vi.fn() } as unknown as { push: ReturnType<typeof vi.fn> };

    navigateOrRevealResult(router as unknown as AppRouterInstance, "/trade-room/purchase-123?action=confirm-usdt-received#action-required", "trade-action-result");

    expect(router.push).toHaveBeenCalledWith("/trade-room/purchase-123?action=confirm-usdt-received#action-required");
  });
});
