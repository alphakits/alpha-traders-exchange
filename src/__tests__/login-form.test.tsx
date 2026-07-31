import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects immediately after a successful login without waiting for the profile check", async () => {
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: replaceSpy },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            role: "buyer",
            roles: ["buyer"],
            sellerStatus: "buyer",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ user: null }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm locale="en" redirectTo="/en/dashboard/seller" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/en/dashboard/seller"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
