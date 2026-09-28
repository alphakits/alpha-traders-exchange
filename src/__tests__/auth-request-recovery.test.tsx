import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("token_hash=test-reset-token&type=recovery") }));
const originalLocation = window.location;
const replace = vi.fn();

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); replace.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

it.each([
  ["login", LoginForm], ["registration", RegisterForm], ["reset request", ForgotPasswordForm], ["reset confirmation", ResetPasswordForm],
] as const)("releases %s after stalled headers or body without replaying or accepting a late success", async (_name, Component) => {
  for (const phase of ["fetch", "body"]) {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const response = { ok: true, status: 200, headers: new Headers(), json: () => phase === "body" ? pending : Promise.resolve({ user: { role: "buyer" } }) };
    const fetchMock = vi.fn(() => phase === "fetch" ? pending : Promise.resolve(response));
    vi.stubGlobal("fetch", fetchMock);
    const page = render(<Component locale="en" />);
    for (const input of page.container.querySelectorAll<HTMLInputElement>("input")) {
      if (input.type === "checkbox") { if (!input.checked) fireEvent.click(input); }
      else fireEvent.change(input, { target: { value: input.type === "email" ? "recovery@example.test" : input.type === "tel" ? "0501234567" : input.type === "password" ? "recovery-password" : "Recovery User" } });
    }
    const form = page.container.querySelector("form")!;
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert").textContent).toContain("Unable to reach the server");
    expect(page.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finish(phase === "fetch" ? response : { user: { role: "buyer" } }); });
    expect(replace).not.toHaveBeenCalled();
    expect(page.container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!.value).not.toBe("");
    page.unmount();
  }
});
