import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RememberedLoginResponse } from "@alpha-traders/contracts";
const mocks = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/app-remembered-login", () => ({ requestAppRememberedLogin: mocks.request }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import { LoginForm } from "@/components/auth/login-form";
const originalLocation = window.location;
const credentials = { email: "buyer@example.test", password: "remembered-password" };
const ok = { type: "alpha.native.remembered-login", version: 1, requestId: "00000000-1111-2222-3333-444444444444", status: "ok" } as const;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  window.ReactNativeWebView = { postMessage: vi.fn() };
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace: mocks.replace } });
  mocks.request.mockResolvedValue({ ...ok, credentials });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ user: { role: "buyer", roles: ["buyer"] } }) });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); delete window.ReactNativeWebView;
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});
const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const password = () => screen.getByLabelText("Password") as HTMLInputElement;

describe("app Remember me integration", () => {
  it("fills email and masked password after every return to login without auto-submitting", async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      const view = render(<LoginForm locale="en" />);
      await waitFor(() => expect(email().value).toBe(credentials.email));
      expect(password().value).toBe(credentials.password);
      expect(password().type).toBe("password");
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
      view.unmount();
    }
  });
  it("waits for the secure save only after authentication succeeds, before navigating", async () => {
    let finishSave!: (value: RememberedLoginResponse) => void;
    mocks.request.mockImplementation((action: string) => action === "load"
      ? Promise.resolve({ ...ok, credentials }) : new Promise(resolve => { finishSave = resolve; }));
    render(<LoginForm locale="en" />);
    await waitFor(() => expect(email().value).toBe(credentials.email));
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("save", expect.objectContaining(credentials)));
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    await act(async () => finishSave(ok));
    expect(mocks.replace).toHaveBeenCalledWith("/en/usdt-exchange");
    expect(localStorage.length).toBe(0);
  });
  it("never saves an incorrect password or unverified login", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Login failed" }) });
    render(<LoginForm locale="en" />);
    await waitFor(() => expect(email().value).toBe(credentials.email));
    fireEvent.change(password(), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.request.mock.calls.map(([action]) => action)).toEqual(["load"]);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("remembers a fast login even when the initial native read has not finished", async () => {
    let finishLoad!: (value: RememberedLoginResponse) => void;
    mocks.request.mockImplementation((action: string) => action === "load"
      ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve(ok));
    render(<LoginForm locale="en" />);
    fireEvent.change(email(), { target: { value: credentials.email } });
    fireEvent.change(password(), { target: { value: credentials.password } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => finishLoad({ ...ok, credentials: null }));
    expect(mocks.request).toHaveBeenCalledWith("save", credentials);
    expect(mocks.replace).toHaveBeenCalledWith("/en/usdt-exchange");
  });
  it("forgets details immediately when unchecked and does not restore on the next login page", async () => {
    mocks.request.mockImplementation((action: string) => Promise.resolve(action === "load" ? { ...ok, credentials } : ok));
    const view = render(<LoginForm locale="en" />);
    await waitFor(() => expect(email().value).toBe(credentials.email));
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("clear"));
    view.unmount();
    render(<LoginForm locale="en" />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(email().value).toBe("");
    expect(password().value).toBe("");
    expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!))).not.toContain(credentials.password);
  });
  it("does not let a late remembered response overwrite typing", async () => {
    let finish!: (value: RememberedLoginResponse) => void;
    mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<LoginForm locale="en" />);
    fireEvent.change(email(), { target: { value: "different@example.test" } });
    await act(async () => finish({ ...ok, credentials }));
    expect(email().value).toBe("different@example.test");
    expect(password().value).toBe("");
  });
  it("clears outdated credentials after a password reset", async () => {
    mocks.request.mockResolvedValue(ok);
    render(<LoginForm locale="en" passwordResetSuccess />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("clear"));
    expect(password().value).toBe("");
  });
  it("keeps old app login usable and explains that remembering credentials needs the app update", async () => {
    mocks.request.mockResolvedValue(null);
    render(<LoginForm locale="en" />);
    await waitFor(() => expect(screen.getByText(/Update the app to remember/)).toBeTruthy());
    fireEvent.change(email(), { target: { value: credentials.email } });
    fireEvent.change(password(), { target: { value: credentials.password } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/en/usdt-exchange"));
    expect(mocks.request.mock.calls.map(([action]) => action)).toEqual(["load"]);
  });
  it("leaves browser Remember me behavior unchanged", () => {
    delete window.ReactNativeWebView;
    render(<LoginForm locale="en" />);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(email().value).toBe("");
    expect(password().value).toBe("");
    expect(screen.queryByText(/Update the app to remember/)).toBeNull();
  });
});
