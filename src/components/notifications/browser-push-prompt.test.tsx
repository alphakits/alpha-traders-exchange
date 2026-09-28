import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserPushPrompt } from "@/components/notifications/browser-push-prompt";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserPushPrompt", () => {
  it.each(["ar", "en"] as const)("renders nothing and never requests permission for %s", (locale) => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });

    const { container } = render(<BrowserPushPrompt locale={locale} />);

    expect(container.innerHTML).toBe("");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
