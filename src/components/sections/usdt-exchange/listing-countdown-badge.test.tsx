import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ListingCountdownBadge } from "./listing-countdown-badge";

const start = Date.UTC(2026, 10, 2, 10);
const minute = 60_000;
const hour = 60 * minute;
const expiresIn = (ms: number) => new Date(start + ms).toISOString();
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("hydrates across a minute boundary using the current client time", async () => {
  const badge = <ListingCountdownBadge expiresAt={expiresIn(minute + 100)} isAr={false} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(badge);
  expect(container.textContent).toBe("");
  vi.setSystemTime(start + 100);
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, badge, { onRecoverableError }); });
    expect(container.querySelector('[role="timer"]')?.textContent).toMatch(/1/);
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    act(() => root?.unmount());
  }
});

it("wakes a mounted card at twelve hours and changes tier at four hours", () => {
  render(<ListingCountdownBadge expiresAt={expiresIn(12 * hour + 1)} isAr={false} />);
  expect(screen.queryByRole("timer")).toBeNull();
  advance(1);
  expect(screen.getByRole("timer").classList.contains("seller-listing-countdown--neutral")).toBe(true);
  advance(8 * hour - 1);
  expect(screen.getByRole("timer").classList.contains("seller-listing-countdown--neutral")).toBe(true);
  advance(1);
  expect(screen.getByRole("timer").classList.contains("seller-listing-countdown--urgent")).toBe(true);
});

it("updates at the remaining-minute boundary and stops exactly at expiry", () => {
  render(<ListingCountdownBadge expiresAt={expiresIn(minute + 500)} isAr={false} />);
  const timer = screen.getByRole("timer");
  const initialLabel = timer.textContent;
  expect(initialLabel).toMatch(/2/);
  advance(499);
  expect(timer.textContent).toBe(initialLabel);
  advance(1);
  expect(timer.textContent).toMatch(/1/);
  expect(timer.getAttribute("aria-label")).toBe(`Listing expiry: ${timer.textContent}`);
  advance(minute - 1);
  expect(screen.getByRole("timer").textContent).toMatch(/1/);
  advance(1);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("replaces a distant wake-up when the expiry changes and cleans up on unmount", () => {
  const view = render(<ListingCountdownBadge expiresAt={expiresIn(35 * 24 * hour)} isAr />);
  expect(screen.queryByRole("timer")).toBeNull();
  act(() => { vi.advanceTimersToNextTimer(); });
  expect(Date.now() - start).toBe(2_147_483_647);
  expect(screen.queryByRole("timer")).toBeNull();
  expect(vi.getTimerCount()).toBe(1);
  view.rerender(<ListingCountdownBadge expiresAt="invalid" isAr />);
  expect(vi.getTimerCount()).toBe(0);
  view.rerender(<ListingCountdownBadge isAr />);
  expect(vi.getTimerCount()).toBe(0);
  view.rerender(<ListingCountdownBadge expiresAt={new Date(Date.now() + minute).toISOString()} isAr />);
  const timer = screen.getByRole("timer");
  expect(timer.getAttribute("aria-label")).toBe(`انتهاء العرض: ${timer.textContent}`);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
