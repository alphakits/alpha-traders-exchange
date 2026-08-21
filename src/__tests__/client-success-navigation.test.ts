// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { navigateOrRevealResult } from "@/lib/client-success-navigation";

describe("client success navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("navigates when the canonical result belongs to another context", () => {
    const router = { push: vi.fn() } as unknown as { push: ReturnType<typeof vi.fn> };

    navigateOrRevealResult(router as unknown as AppRouterInstance, "/trade-room/purchase-123?action=confirm-usdt-received#action-required", "trade-action-result");

    expect(router.push).toHaveBeenCalledWith("/trade-room/purchase-123?action=confirm-usdt-received#action-required");
  });
});
