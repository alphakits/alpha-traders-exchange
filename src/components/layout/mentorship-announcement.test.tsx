import type { AnchorHTMLAttributes } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MentorshipAnnouncement } from "./mentorship-announcement";

const nav = vi.hoisted(() => ({ path: "/", refresh: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ locale, href, prefetch, replace, onNavigate, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string; prefetch: boolean; replace?: boolean; onNavigate?: unknown }) => {
    void prefetch; void onNavigate;
    return <a {...rest} data-replace={Boolean(replace)} href={`/${locale}${href}`} />;
  },
  usePathname: () => nav.path,
  useRouter: () => nav,
}));

afterEach(() => {
  cleanup();
  nav.path = "/";
  nav.refresh.mockClear();
  vi.useRealTimers();
});

it.each(["en", "ar"] as const)("shows the %s offer to any visitor and advances an open tab at Israel midnight", locale => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T21:59:59.999Z"));
  const { container } = render(<MentorshipAnnouncement locale={locale} initialPhase="standard" />);
  expect(container.firstChild).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("link").getAttribute("href")).toBe(`/${locale}/mentorship-offer`);
  expect(screen.getByRole("link").getAttribute("data-replace")).toBe("false");
  expect(container.querySelector("aside")?.dataset.mentorshipAnnouncement).toBe("november");
  expect(screen.getByRole("link", { name: locale === "ar" ? "انضم" : "Join" })).toBeTruthy();
  expect(screen.getByText(locale === "ar" ? /في 1 ديسمبر/ : "Price +10% Dec 1")).toBeTruthy();
  vi.setSystemTime(new Date("2026-11-27T02:48:00.000Z"));
  act(() => window.dispatchEvent(new Event("pageshow")));
  const timer = screen.getByRole("timer");
  expect(timer.textContent).toBe(locale === "ar" ? "3ي 19س 12د" : "3d 19h 12m");
  act(() => vi.advanceTimersByTime(60_000));
  expect(timer.textContent).toBe(locale === "ar" ? "3ي 19س 11د" : "3d 19h 11m");
  vi.setSystemTime(new Date("2026-11-30T21:59:59.999Z"));
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(timer.textContent).toBe(locale === "ar" ? "0ي 0س 1د" : "0d 0h 1m");
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("timer")).toBeNull();
  expect(container.querySelector("aside")?.dataset.mentorshipAnnouncement).toBe("december");
  expect(container.querySelector("aside")?.textContent).toContain("31");
  act(() => vi.advanceTimersByTime(31 * 86_400_000));
  expect(container.firstChild).toBeNull();
  expect(nav.refresh).not.toHaveBeenCalled();
});

it.each(["/learn-with-mark", "/mentorship-offer"])("updates stale tuition on %s after a suspended tab wakes", path => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-30T09:00:00Z"));
  nav.path = path;
  render(<MentorshipAnnouncement locale="en" initialPhase="november" />);
  expect(screen.getByRole("link").getAttribute("href")).toBe(path === "/mentorship-offer" ? "/en/mentorship-offer#offer-details" : "/en/mentorship-offer");
  expect(screen.getByRole("link").getAttribute("data-replace")).toBe(String(path === "/mentorship-offer"));
  vi.setSystemTime(new Date("2026-12-01T09:00:00Z"));
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(screen.getByRole("link", { name: "Details" })).toBeTruthy();
  expect(screen.queryByRole("timer")).toBeNull();
  expect(nav.refresh).toHaveBeenCalledOnce();
});
