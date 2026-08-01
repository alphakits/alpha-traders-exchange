import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/components/auth/logout-button";

describe("LogoutButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows immediate pending feedback and prevents duplicate clicks", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: replaceSpy },
    });

    render(<LogoutButton locale="en">Sign out</LogoutButton>);

    const button = screen.getByRole("button", { name: "Sign out" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Signing out..." }).hasAttribute("disabled")).toBe(true);

    resolveFetch?.({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/en/login"));

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("re-enables the button and shows an error when logout fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Logout failed." }),
    }));

    render(<LogoutButton locale="en">Sign out</LogoutButton>);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Logout failed."));
    expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
  });
});
