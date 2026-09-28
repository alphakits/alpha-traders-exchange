import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/components/auth/logout-button";
import { LOCALE_CHOICE_COOKIE } from "@/i18n/locale-preference";

describe("LogoutButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears Arabic only after successful logout and immediately opens the public English home", async () => {
    const originalLocation = window.location;
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
    document.cookie = `${LOCALE_CHOICE_COOKIE}=ar; Path=/`;
    let finish: (value: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    try {
      render(<LogoutButton locale="ar">تسجيل الخروج</LogoutButton>);
      fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
      expect(document.cookie).toContain(`${LOCALE_CHOICE_COOKIE}=ar`);
      expect(replace).not.toHaveBeenCalled();
      finish({ ok: true } as Response);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/en"));
      expect(document.cookie).not.toContain(`${LOCALE_CHOICE_COOKIE}=ar`);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("shows immediate pending feedback and prevents duplicate clicks", async () => {
    let resolveFetch: ((value: Response | PromiseLike<Response>) => void) | undefined;
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

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/en"));

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("re-enables the button and shows an error when logout fails", async () => {
    document.cookie = `${LOCALE_CHOICE_COOKIE}=ar; Path=/`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Logout failed." }),
    }));

    render(<LogoutButton locale="en">Sign out</LogoutButton>);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Logout failed."));
    expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
    expect(document.cookie).toContain(`${LOCALE_CHOICE_COOKIE}=ar`);
  });
});
