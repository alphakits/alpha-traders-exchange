import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeLocationMap } from "./trade-location-map";
import { mapCoordinates, mapWorldPoint } from "@/lib/trade-location-map";

const point = { version: 1, latitude: 33.123456, longitude: 36.654321, source: "current" } as const;
afterEach(cleanup);
describe("location picker stays in sync with the selected point", () => {
  it("uses GPS coordinates selected after the map was already opened", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TradeLocationMap isAr={false} onSelect={onSelect} />);
    rerender(<TradeLocationMap initial={point} isAr={false} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].latitude).toBeCloseTo(point.latitude, 6);
    expect(onSelect.mock.calls[0][0].longitude).toBeGreaterThan(point.longitude);
  });
  it("updates the map when manual coordinates replace a previously previewed point", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TradeLocationMap initial={{ ...point, latitude: 32, longitude: 35 }} isAr={false} onSelect={onSelect} />);
    rerender(<TradeLocationMap initial={point} isAr={false} onSelect={onSelect} />);
    const world = mapWorldPoint(point.latitude, point.longitude, 16);
    const expected = mapCoordinates(world.x, world.y - 50, 16);
    fireEvent.keyDown(screen.getByRole("application"), { key: "ArrowUp" });
    expect(onSelect.mock.calls[0][0].latitude).toBeCloseTo(expected.latitude, 6);
    expect(onSelect.mock.calls[0][0].longitude).toBeCloseTo(expected.longitude, 6);
  });
});

it("does not change point or zoom while a location is being sent", () => {
  const onSelect = vi.fn();
  render(<TradeLocationMap initial={point} isAr={false} onSelect={onSelect} disabled />);
  const map = screen.getByRole("application");
  expect(map.getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(map, { key: "ArrowRight" });
  expect(onSelect).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(true);
});
