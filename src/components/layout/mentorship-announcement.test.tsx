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
  vi.setSystemTime(new Date("2026-11-30T21:59:58.999Z"));
  act(() => window.dispatchEvent(new Event("pageshow")));
  const timer = screen.getByRole("timer");
  const digits = () => Array.from(timer.querySelectorAll("b"), cell => cell.textContent);
  expect(digits()).toEqual(["00", "00", "00", "02"]);
  act(() => vi.advanceTimersByTime(1));
  expect(digits()).toEqual(["00", "00", "00", "01"]);
  act(() => vi.advanceTimersByTime(1_000));
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
  expect(screen.getByRole("link").textContent).toBe("View mentorship");
  expect(screen.queryByRole("timer")).toBeNull();
  expect(nav.refresh).toHaveBeenCalledOnce();
});
