import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FooterConnectionCheck } from "./footer-connection-check";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const healthy = () => ({ status: "ok", checks: { database: "ok" }, timestamp: new Date().toISOString() });
it("makes no health claim or request until checked, then confirms the actual response", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(healthy())); vi.stubGlobal("fetch", fetch);
  render(<FooterConnectionCheck isAr={false} />);
  expect(fetch).not.toHaveBeenCalled(); expect(screen.getByRole("status").textContent).toBe("");
  fireEvent.click(screen.getByRole("button")); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Last check passed"));
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  { payload: { status: "ok" }, status: 200 },
  { payload: healthy(), status: 503 },
  { payload: { ...healthy(), timestamp: "2020-01-01T00:00:00Z" }, status: 200 },
])("does not report success for an invalid, failed or stale check %#", async ({ payload, status }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload, { status })));
  render(<FooterConnectionCheck isAr={false} />); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("unconfirmed"));
});
it("recovers from an induced outage and supports Arabic", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json(healthy())));
  render(<FooterConnectionCheck isAr />); fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("تعذر"));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("نجح آخر فحص"));
});
it("bounds a stalled transport and makes retry available", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<FooterConnectionCheck isAr={false} />); fireEvent.click(screen.getByRole("button"));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByRole("status").textContent).toContain("unconfirmed");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
});
