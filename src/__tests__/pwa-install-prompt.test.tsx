import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallPrompt } from "@/components/pwa/pwa-install-prompt";

const dismissalKey = "alpha.pwa.install.dismissed";

function offerInstall(overrides: Partial<{ prompt: () => Promise<void> | void; userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }> }> = {}) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(),
    userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    ...overrides,
  });
  fireEvent(window, event);
  return event;
}

beforeEach(() => {
  window.localStorage.removeItem(dismissalKey);
});

describe("PWA installation action", () => {
  it("handles a rejected browser decision even after starting the prompt fails", async () => {
    let rejectChoice!: (reason: Error) => void;
    const choice = new Promise<{ outcome: "accepted" | "dismissed"; platform: string }>((_, reject) => { rejectChoice = reject; });
    render(<PwaInstallPrompt locale="en" />);
    offerInstall({ prompt: vi.fn().mockRejectedValue(new Error("Prompt unavailable")), userChoice: choice });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await act(async () => { rejectChoice(new Error("Decision unavailable")); });
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("uses an installation offer once while waiting for the browser decision", async () => {
    let resolveChoice!: (value: { outcome: "accepted"; platform: string }) => void;
    const choice = new Promise<{ outcome: "accepted"; platform: string }>((resolve) => { resolveChoice = resolve; });
    render(<PwaInstallPrompt locale="en" />);
    const event = offerInstall({ userChoice: choice });
    const button = screen.getByRole("button", { name: "Install" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(event.prompt).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Installing…" }) as HTMLButtonElement).disabled).toBe(true);
    const repeated = offerInstall();
    expect(repeated.prompt).not.toHaveBeenCalled();
    await act(async () => { resolveChoice({ outcome: "accepted", platform: "web" }); });
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  });

  it.each(["en", "ar"] as const)("shows an accessible browser recovery path when the prompt fails in %s", async (locale) => {
    render(<PwaInstallPrompt locale={locale} />);
    const prompt = vi.fn().mockRejectedValue(new DOMException("Offer already consumed", "InvalidStateError"));
    offerInstall({ prompt });
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "تثبيت" : "Install" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(locale === "ar" ? "قائمة المتصفح" : "browser menu"));
    expect(screen.queryByRole("button", { name: locale === "ar" ? "تثبيت" : "Install" })).toBeNull();
    expect(prompt).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "لاحقاً" : "Later" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers from a failed browser decision with a fresh installation offer", async () => {
    let rejectChoice!: (reason: Error) => void;
    const choice = new Promise<{ outcome: "accepted" | "dismissed"; platform: string }>((_, reject) => { rejectChoice = reject; });
    render(<PwaInstallPrompt locale="en" />);
    offerInstall({ userChoice: choice });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await act(async () => { rejectChoice(new Error("Browser decision unavailable")); });
    expect(screen.getByRole("alert")).toBeTruthy();
    const fresh = offerInstall();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Later" })).toBeNull());
    expect(fresh.prompt).toHaveBeenCalledOnce();
  });

  it("keeps a dismissed offer closed if the pending installation later fails", async () => {
    let rejectPrompt!: (reason: Error) => void;
    const prompt = vi.fn(() => new Promise<void>((_, reject) => { rejectPrompt = reject; }));
    render(<PwaInstallPrompt locale="en" />);
    offerInstall({ prompt });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await act(async () => { rejectPrompt(new Error("Screen closed")); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    offerInstall();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("handles a pending installation failure after the component unmounts", async () => {
    let rejectPrompt!: (reason: Error) => void;
    const prompt = vi.fn(() => new Promise<void>((_, reject) => { rejectPrompt = reject; }));
    const view = render(<PwaInstallPrompt locale="en" />);
    offerInstall({ prompt });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    view.unmount();
    await act(async () => { rejectPrompt(new Error("Document closed")); });
    expect(screen.queryByRole("alert")).toBeNull();
  });
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
