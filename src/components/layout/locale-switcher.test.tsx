import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_CHOICE_COOKIE } from "@/i18n/locale-preference";

const mocks = vi.hoisted(() => ({ locale: "en", pathname: "/login", replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => mocks.locale }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

import { LocaleSwitcher } from "./locale-switcher";

describe("explicit language switch", () => {
  beforeEach(() => {
    mocks.locale = "en";
    mocks.pathname = "/login";
    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/en/login");
    document.cookie = `${LOCALE_CHOICE_COOKIE}=; Path=/; Max-Age=0`;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("remembers Arabic and keeps the destination, query and anchor while switching login language", () => {
    window.history.replaceState({}, "", "/en/login?redirectTo=%2Fen%2Ftrade-room%2Ftrade-123%3Ftab%3Dmessages&sessionExpired=1#form");
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Arabic" }));
    expect(document.cookie).toContain(`${LOCALE_CHOICE_COOKIE}=ar`);
    const [href, options] = mocks.replace.mock.calls[0];
    const destination = new URL(href, "https://www.alphatraders.co.il");
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("redirectTo")).toBe("/ar/trade-room/trade-123?tab=messages");
    expect(destination.searchParams.get("sessionExpired")).toBe("1");
    expect(destination.hash).toBe("#form");
    expect(options).toEqual({ locale: "ar" });
  });

  it("remembers switching back to English", () => {
    mocks.locale = "ar";
    mocks.pathname = "/usdt-exchange";
    document.cookie = `${LOCALE_CHOICE_COOKIE}=ar; Path=/`;
    window.history.replaceState({}, "", "/ar/usdt-exchange#commission-status");
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "التبديل إلى الإنجليزية" }));
    expect(document.cookie).toContain(`${LOCALE_CHOICE_COOKIE}=en`);
    expect(mocks.replace).toHaveBeenCalledWith("/usdt-exchange#commission-status", { locale: "en" });
  });

  it("still switches when preference storage is blocked", () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => { throw new Error("Storage blocked"); });
    render(<LocaleSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Arabic" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login", { locale: "ar" });
  });
});
