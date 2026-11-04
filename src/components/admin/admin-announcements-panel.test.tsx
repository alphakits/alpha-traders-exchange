import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { localeMock } = vi.hoisted(() => ({
  localeMock: vi.fn(() => "ar"),
}));

vi.mock("next-intl", () => ({
  useLocale: localeMock,
}));

import { AdminAnnouncementsPanel } from "@/components/admin/admin-announcements-panel";

afterEach(() => vi.unstubAllGlobals());

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

describe("AdminAnnouncementsPanel PDF attachments", () => {
  const pdf = "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n";
  const filename = "Seller Guide & Rules.pdf";
  const run = {
    id: "announcement-pdf-1",
    audience: "approved_sellers",
    subject: "دليل البائع | Seller guide",
    title: "دليل البائع | Seller guide",
    recipientCount: 2,
    successCount: 2,
    failureCount: 0,
    retryCount: 0,
    status: "completed",
    startedAt: "2026-11-04T12:00:00.000Z",
    finishedAt: "2026-11-04T12:01:00.000Z",
  };

  beforeEach(() => {
    localeMock.mockReturnValue("en");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (url.endsWith("/test")) body = { sent: true };
      else if (init?.method === "POST") body = { run };
      else body = { recipientCount: url.includes("attachment=pdf") ? 2 : 3, runs: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  function selectSellers() {
    fireEvent.change(screen.getByRole("combobox", { name: "Recipients" }), { target: { value: "approved_sellers" } });
  }

  async function uploadPdf() {
    fireEvent.change(screen.getByLabelText("PDF attachment"), {
      target: { files: [new File([pdf], filename, { type: "application/pdf" })] },
    });
    await screen.findByRole("button", { name: "Remove PDF" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Review and send to 2" }) as HTMLButtonElement).disabled).toBe(false));
  }

  it("offers attachment upload only to an owner targeting approved sellers", async () => {
    const view = render(<AdminAnnouncementsPanel />);
    selectSellers();
    expect(screen.queryByLabelText("PDF attachment")).toBeNull();
    view.unmount();

    render(<AdminAnnouncementsPanel isOwner />);
    expect(screen.queryByLabelText("PDF attachment")).toBeNull();
    selectSellers();
    expect(screen.getByLabelText("PDF attachment")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Recipients" }), { target: { value: "buyers" } });
    expect(screen.queryByLabelText("PDF attachment")).toBeNull();
  });

  it("recounts the PDF audience and includes the exact file in test and confirmed delivery requests", async () => {
    render(<AdminAnnouncementsPanel isOwner />);
    selectSellers();
    await uploadPdf();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/alpha-exchange/admin/announcements?audience=approved_sellers&attachment=pdf")).toBe(true);
    fireEvent.change(screen.getByLabelText("Verified test account email"), { target: { value: "seller@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Test" }));
    await screen.findByText("Test announcement sent to seller@example.com.");

    const testRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/test"))?.[1];
    const testPayload = JSON.parse(String(testRequest?.body));
    expect(testPayload.attachment).toEqual({
      filename,
      contentType: "application/pdf",
      contentBase64: Buffer.from(pdf).toString("base64"),
      sizeBytes: Buffer.byteLength(pdf),
    });

    fireEvent.click(screen.getByRole("button", { name: "Review and send to 2" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm announcement delivery" });
    expect(within(dialog).getByText(/Seller Guide & Rules\.pdf/)).toBeTruthy();
    expect(within(dialog).getByText("Approved sellers only")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send announcement" }));
    await screen.findByText("Announcement delivered to 2 recipients.");

    const createRequest = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/alpha-exchange/admin/announcements" && init?.method === "POST")?.[1];
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({
      audience: "approved_sellers",
      expectedRecipientCount: 2,
      attachment: testPayload.attachment,
    });
  });

  it("removes PDF bytes from subsequent requests when the attachment is removed", async () => {
    render(<AdminAnnouncementsPanel isOwner />);
    selectSellers();
    await uploadPdf();
    fireEvent.click(screen.getByRole("button", { name: "Remove PDF" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Review and send to 3" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Verified test account email"), { target: { value: "seller@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Test" }));
    await screen.findByText("Test announcement sent to seller@example.com.");
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/test"))?.[1];
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("attachment");
  });

  it.each([
    { name: "guide.html", bytes: new Uint8Array(20), type: "text/html" },
    { name: "guide.pdf", bytes: new Uint8Array(2 * 1024 * 1024 + 1), type: "application/pdf" },
  ])("rejects invalid or oversized files before they are attached ($name)", async (file) => {
    render(<AdminAnnouncementsPanel isOwner />);
    selectSellers();
    fireEvent.change(screen.getByLabelText("PDF attachment"), { target: { files: [new File([file.bytes], file.name, { type: file.type })] } });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Choose a PDF no larger than 2 MB.");
    expect(screen.queryByRole("button", { name: "Remove PDF" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("attachment=pdf"))).toBe(false);
  });
});
