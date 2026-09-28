import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountNotificationPreferences } from "./account-notification-preferences";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("account notification preferences", () => {
  it("loads saved choices and saves only the controls moved from Home", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preferences: { inApp: false, email: true, sms: true, browserPush: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountNotificationPreferences locale="en" />);
    const inApp = await screen.findByRole("checkbox", { name: "In-app" }) as HTMLInputElement;
    expect(inApp.checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Email" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(inApp);
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
    await screen.findByText("Notification preferences updated.");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/alpha-exchange/notification-preferences", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ inApp: true, email: true }) }));
  });

  it("does not permit overwriting preferences when loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    render(<AccountNotificationPreferences locale="en" />);
    await screen.findByText("Could not load notification preferences. Please try again.");
    expect(screen.queryByRole("button", { name: "Save Preferences" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("reports save failures without claiming success, in Arabic", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ preferences: { inApp: true, email: false } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 })));
    render(<AccountNotificationPreferences locale="ar" />);
    fireEvent.click(await screen.findByRole("button", { name: "حفظ التفضيلات" }));
    await waitFor(() => expect(screen.getByText("تعذر حفظ تفضيلات الإشعارات. حاول مرة أخرى.")).toBeTruthy());
    expect(screen.queryByText("تم تحديث تفضيلات الإشعارات.")).toBeNull();
  });
});
