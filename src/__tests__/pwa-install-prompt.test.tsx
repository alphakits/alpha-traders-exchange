import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";

const dismissalKey = "alpha.pwa.install.dismissed";

function offerInstall() {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(),
    userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
  });
  fireEvent(window, event);
  return event;
}

beforeEach(() => {
  window.localStorage.removeItem(dismissalKey);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(dismissalKey);
});

describe("PWA installation dismissal", () => {
  it("keeps Later dismissed when navigation offers installation again", () => {
    const view = render(<PwaInstallPrompt locale="en" />);
    offerInstall();
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    view.rerender(<PwaInstallPrompt locale="ar" />);
    const repeated = offerInstall();
    expect(screen.queryByRole("button", { name: "لاحقاً" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تثبيت" })).toBeNull();
    expect(repeated.defaultPrevented).toBe(true);
  });

  it("respects a dismissal saved after the listener was mounted", () => {
    render(<PwaInstallPrompt locale="en" />);
    window.localStorage.setItem(dismissalKey, "1");
    offerInstall();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("keeps the current session dismissed when saving the preference fails", () => {
    render(<PwaInstallPrompt locale="en" />);
    offerInstall();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    offerInstall();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("retains a previously saved dismissal after a fresh page mount", () => {
    window.localStorage.setItem(dismissalKey, "1");
    render(<PwaInstallPrompt locale="ar" />);
    offerInstall();
    expect(screen.queryByRole("button", { name: "لاحقاً" })).toBeNull();
  });
});
