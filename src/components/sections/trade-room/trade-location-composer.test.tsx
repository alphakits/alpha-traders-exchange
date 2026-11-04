import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeLocationComposer } from "./trade-location-composer";
import { TradeLocationCard } from "./trade-location-card";

const getPosition = vi.fn();
let success: PositionCallback;
let failure: PositionErrorCallback;
const position = { coords: { latitude: 32.123456, longitude: 35.654321, accuracy: 10 } } as GeolocationPosition;
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: getPosition, watchPosition: vi.fn() } });
  getPosition.mockReset().mockImplementation((ok: PositionCallback, fail: PositionErrorCallback) => { success = ok; failure = fail; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Share meeting location" }));
const locate = () => fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
const confirm = () => screen.getByRole("button", { name: "Confirm and send location" }) as HTMLButtonElement;

describe("location consent and confirmation", () => {
  it("does not request GPS or load third-party tiles merely by mounting/opening", () => {
    const onSend = vi.fn(); const { container } = render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />);
    expect(getPosition).not.toHaveBeenCalled(); open();
    expect(getPosition).not.toHaveBeenCalled(); expect(container.querySelector("img")).toBeNull();
    expect(confirm().disabled).toBe(true); expect(onSend).not.toHaveBeenCalled();
  });
  it("previews a one-shot GPS position and sends only after confirmation, once", async () => {
    let finish!: (value: boolean) => void;
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate();
    expect(getPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    act(() => success(position)); expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText("Preview only — not sent")).toBeTruthy();
    const button = confirm(); fireEvent.click(button); fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1); expect(onSend).toHaveBeenCalledWith({ version: 1, latitude: 32.123456, longitude: 35.654321, source: "current", accuracyMeters: 10 });
    await act(async () => { finish(true); });
    expect(screen.queryByText("Preview only — not sent")).toBeNull();
  });
  it("ignores late GPS callbacks after cancellation", () => {
    const onSend = vi.fn(); render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); act(() => success(position)); open();
    expect(confirm().disabled).toBe(true); expect(screen.queryByTestId("trade-location-card")).toBeNull(); expect(onSend).not.toHaveBeenCalled();
  });
  it("offers a non-GPS fallback after permission denial, with a second confirmation", async () => {
    const onSend = vi.fn().mockResolvedValue(true); render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate();
    act(() => failure({ code: 1 } as GeolocationPositionError)); expect(screen.getByRole("alert").textContent).toContain("permission was denied");
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "32.123456" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "35.654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview meeting point" }));
    expect(onSend).not.toHaveBeenCalled(); fireEvent.click(confirm()); await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });
  it("rejects arbitrary phone/link coordinate input", () => {
    const onSend = vi.fn(); render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open();
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "0501234567" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "https://wa.me/123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview meeting point" }));
    expect(screen.getByRole("alert").textContent).toContain("valid coordinates"); expect(confirm().disabled).toBe(true); expect(onSend).not.toHaveBeenCalled();
  });
  it("keeps an uncertain location available for safe retry", async () => {
    const onSend = vi.fn().mockResolvedValue(false); render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate(); act(() => success(position));
    fireEvent.click(confirm()); await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("safe retry"));
    expect(screen.getByTestId("trade-location-card")).toBeTruthy(); expect(confirm().disabled).toBe(false);
  });
  it.each([2, 3])("handles GPS error %s without sending or getting stuck", code => {
    const onSend = vi.fn(); render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate();
    act(() => failure({ code } as GeolocationPositionError)); expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use my current location" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });
  it("remains disabled while another chat/action request is running", () => {
    render(<TradeLocationComposer isAr={false} disabled onSend={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Share meeting location" }) as HTMLButtonElement).disabled).toBe(true);
    expect(getPosition).not.toHaveBeenCalled();
  });
  it("renders an Arabic location card without fetching maps or exposing a referrer", () => {
    const { container } = render(<TradeLocationCard isAr location={{ version: 1, latitude: 32, longitude: 35, source: "meeting_point" }} />);
    expect(screen.getByText("نقطة اللقاء")).toBeTruthy(); expect(container.querySelector("img")).toBeNull();
    for (const link of screen.getAllByRole("link")) { expect(link.getAttribute("referrerpolicy")).toBe("no-referrer"); expect(link.getAttribute("rel")).toContain("noreferrer"); }
  });
});


describe("location clarity and send safety follow-up", () => {
  it("shows the three steps and explicit success only after an acknowledgement", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open();
    expect(screen.getByText("1. Choose location · 2. Check preview · 3. Confirm send")).toBeTruthy();
    locate(); act(() => success(position));
    expect(screen.queryByText(/Location sent in the chat/)).toBeNull();
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText(/Location sent in the chat/)).toBeTruthy());
    open(); expect(screen.queryByText(/Location sent in the chat/)).toBeNull();
  });
  it("requires a new preview after manual coordinate fields are edited", () => {
    render(<TradeLocationComposer isAr={false} disabled={false} onSend={vi.fn()} />); open();
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview meeting point" }));
    expect(confirm().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "33" } });
    expect(confirm().disabled).toBe(true); expect(screen.queryByTestId("trade-location-card")).toBeNull();
  });
  it("locks the displayed map while the chosen location is awaiting acknowledgement", async () => {
    let done!: (ok: boolean) => void;
    const onSend = vi.fn(() => new Promise<boolean>(resolve => { done = resolve; }));
    render(<TradeLocationComposer isAr={false} disabled={false} onSend={onSend} />); open(); locate(); act(() => success(position));
    fireEvent.click(screen.getByRole("button", { name: "Choose on map" }));
    fireEvent.click(confirm());
    const map = screen.getByRole("application"); expect(map.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(map, { key: "ArrowRight" });
    expect(screen.getByTestId("trade-location-card").textContent).toContain("32.123456, 35.654321");
    await act(async () => done(true));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it("shows the numbered steps and acknowledgement in Arabic", async () => {
    render(<TradeLocationComposer isAr disabled={false} onSend={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "إرسال موقع اللقاء" }));
    expect(screen.getByText("١. اختَر الموقع · ٢. راجع المعاينة · ٣. أكّد الإرسال")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تحديد موقعي الحالي" })); act(() => success(position));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد وإرسال الموقع" }));
    await waitFor(() => expect(screen.getByText(/تم إرسال الموقع داخل الشات/)).toBeTruthy());
  });
});
