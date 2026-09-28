import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { localeMock } = vi.hoisted(() => ({
  localeMock: vi.fn(() => "ar"),
}));

vi.mock("next-intl", () => ({
  useLocale: localeMock,
}));

import { AdminAnnouncementsPanel } from "@/components/admin/admin-announcements-panel";

describe("AdminAnnouncementsPanel localization", () => {
  beforeEach(() => {
    localeMock.mockReturnValue("ar");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/test")) {
        return new Response(JSON.stringify({ sent: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ recipientCount: 2, runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));
  });

  it("shows an Arabic-localized admin UI with required Arabic and English drafts", async () => {
    render(<AdminAnnouncementsPanel />);

    expect(await screen.findByText("الإعلانات")).toBeTruthy();
    expect(screen.getByText("النسخة العربية")).toBeTruthy();
    expect(screen.getByText("النسخة الإنجليزية")).toBeTruthy();
    expect(screen.getByDisplayValue(/أصبح Alpha Exchange متاحًا رسميًا/)).toBeTruthy();
    expect(screen.getByDisplayValue(/Alpha Exchange is Officially Live/)).toBeTruthy();
    expect(screen.getByText("معاينة البريد ثنائي اللغة")).toBeTruthy();
  });

  it("serializes both language drafts in every test delivery", async () => {
    render(<AdminAnnouncementsPanel />);
    await screen.findByText("الإعلانات");

    fireEvent.change(screen.getByLabelText("بريد حساب تجريبي موثّق"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال نسخة تجريبية" }));

    await waitFor(() => expect(screen.getByText("تم إرسال إعلان تجريبي إلى owner@example.com.")).toBeTruthy());
    const fetchMock = vi.mocked(fetch);
    const testCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/test"));
    expect(testCall).toBeDefined();
    const request = testCall?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, string>;
    expect(payload.subject).toMatch(/[\u0600-\u06ff].+ \| .+[A-Za-z]/);
    expect(payload.title).toMatch(/[\u0600-\u06ff].+ \| .+[A-Za-z]/);
    expect(payload.content).toContain("[[ALPHA-ANNOUNCEMENT-EN]]");
    expect(payload.ctaText).toBe("ابدأ التداول | Start Trading");
  });
});
