import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ locale: vi.fn(() => "en") }));
vi.mock("next-intl", () => ({ useLocale: mocks.locale }));

import { MentorshipEmailAudit } from "./mentorship-email-audit";

function snapshot() {
  return {
    campaignId: "mentorship-test-campaign", checkedAt: "2026-11-03T15:01:00Z",
    counts: { total: 3, consented: 2, pending: 1, sent: 1, delivered: 1, held: 0 }, shown: 3, truncated: false,
    recipients: [{
      id: "accepted", userId: "user-one", email: "accepted@example.test", locale: "en",
      status: "sent", consentStatus: "requested", consentVersion: "one-time-v1",
      requestedAt: "2026-11-03T15:00:00Z", firstAttemptAt: "2026-11-03T15:00:01Z",
      sentAt: "2026-11-03T15:00:02Z", deliveredAt: null, holdCodes: [],
      providerEmailId: "provider-message-one", providerCampaignId: null,
      lastReason: null, updatedAt: "2026-11-03T15:00:02Z",
      events: [{ type: "sent", occurredAt: "2026-11-03T15:00:02Z", observedAt: "2026-11-03T15:00:03Z", source: "provider", reason: null }],
    }, {
      id: "imported", userId: "user-two", email: "delivered@example.test", locale: "ar",
      status: "delivered", consentStatus: "legacy_newsletter", consentVersion: null,
      requestedAt: null, firstAttemptAt: null, sentAt: null, deliveredAt: null, holdCodes: [],
      providerEmailId: null, providerCampaignId: "existing-campaign",
      lastReason: "Existing provider delivery evidence", updatedAt: "2026-11-03T14:00:00Z",
      events: [{ type: "delivered", occurredAt: null, observedAt: "2026-11-03T14:00:00Z", source: "imported_provider_report", reason: null }],
    }, {
      id: "owner-preview", userId: "user-three", email: "preview@example.test", locale: "en",
      status: "pending", consentStatus: "none", consentVersion: null,
      requestedAt: null, firstAttemptAt: null, sentAt: null, deliveredAt: null, holdCodes: [],
      providerEmailId: null, providerCampaignId: null, lastReason: null, updatedAt: "2026-11-03T14:00:00Z",
      events: [{ type: "owner_preview_delivered", occurredAt: null, observedAt: "2026-11-03T14:00:00Z", source: "owner_requested_preview", reason: null }],
    }],
  };
}

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  mocks.locale.mockReturnValue("en");
  vi.stubGlobal("fetch", vi.fn(async () => response(snapshot())));
});

describe("MentorshipEmailAudit", () => {
  it("reads on demand and keeps provider acceptance, imported delivery and owner preview distinct", async () => {
    render(<MentorshipEmailAudit />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    expect(await screen.findByText("accepted@example.test")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/alpha-exchange/admin/marketing-email-audit", expect.objectContaining({
      method: "GET", credentials: "same-origin", cache: "no-store",
    }));
    const accepted = screen.getByText("accepted@example.test").closest("tr")!;
    expect(within(accepted).getByText("Sent · delivery unconfirmed")).toBeTruthy();
    expect(within(accepted).queryByText("Existing newsletter subscription")).toBeNull();
    expect(within(accepted).getByText("provider-message-one")).toBeTruthy();
    const delivered = screen.getByText("delivered@example.test").closest("tr")!;
    expect(within(delivered).getByText("Delivered", { selector: "span" })).toBeTruthy();
    expect(within(delivered).getByText("Existing newsletter subscription")).toBeTruthy();
    expect(within(delivered).getByText("Delivery confirmed; exact time unavailable.")).toBeTruthy();
    expect(within(delivered).getByText("Source: imported_provider_report")).toBeTruthy();
    expect(within(delivered).getByText("Delivered", { selector: "dt" }).nextElementSibling?.textContent).toBe("—");
    expect(within(delivered).getByText("Observed: 3 Nov 2026, 14:00")).toBeTruthy();
    expect(within(delivered).queryByText(/^Occurred:/)).toBeNull();
    const preview = screen.getByText("preview@example.test").closest("tr")!;
    expect(within(preview).getByText("Awaiting permission")).toBeTruthy();
    expect(within(preview).getByText("No permission recorded")).toBeTruthy();
    expect(within(preview).getByText("Owner preview delivered")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send|resend/i })).toBeNull();
  });

  it("clears recipient data when owner access is rejected on refresh", async () => {
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    await screen.findByText("accepted@example.test");
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "PRIVATE_DIAGNOSTIC" }, 403));
    fireEvent.click(screen.getByRole("button", { name: "Refresh audit" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign in with the owner account to view this audit.");
    expect(screen.queryByText("accepted@example.test")).toBeNull();
    expect(screen.queryByText("PRIVATE_DIAGNOSTIC")).toBeNull();
  });

  it("does not display server diagnostics or manufacture a zero-recipient report on failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "PRIVATE_DATABASE_ERROR" }, 503));
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The audit is temporarily unavailable. Refresh to try again.");
    expect(screen.queryByText("PRIVATE_DATABASE_ERROR")).toBeNull();
    expect(screen.queryByText("Campaign recipients:")).toBeNull();
  });

  it("filters locally and removes private data on sign-out", async () => {
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    await screen.findByText("accepted@example.test");
    fireEvent.change(screen.getByLabelText("Find an email address"), { target: { value: "delivered@" } });
    expect(screen.queryByText("accepted@example.test")).toBeNull();
    expect(screen.getByText("delivered@example.test")).toBeTruthy();
    fireEvent(window, new Event("alpha-auth-signed-out"));
    expect(screen.queryByText("delivered@example.test")).toBeNull();
    expect(screen.getByRole("button", { name: "Open email audit" }).getAttribute("aria-expanded")).toBe("false");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight response after the audit is hidden", async () => {
    let resolveRead!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide audit" }));
    resolveRead(response(snapshot()));
    await waitFor(() => expect(screen.queryByText("accepted@example.test")).toBeNull());
  });

  it("localizes owner controls and discloses a bounded recipient view", async () => {
    mocks.locale.mockReturnValue("ar");
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...snapshot(), counts: { ...snapshot().counts, total: 1002 }, shown: 3, truncated: true }));
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "فتح سجل البريد" }));
    expect(await screen.findByText("ظاهر آخر 3 من 1002 مستلم. العدادات بتشمل الحملة كاملة.")).toBeTruthy();
    expect(screen.getByText("accepted@example.test")).toBeTruthy();
    expect(screen.getAllByText("أُرسل · الوصول غير مؤكّد").length).toBeGreaterThan(0);
  });

  it("shows cancelled queued requests separately from future deliveries", async () => {
    const data = snapshot();
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...data,
      counts: { total: 1, consented: 0, cancelled: 1 }, shown: 1,
      recipients: [{ ...data.recipients[0], status: "cancelled", consentStatus: "withdrawn", sentAt: null, providerEmailId: null }],
    }));
    render(<MentorshipEmailAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Open email audit" }));
    await screen.findByText("accepted@example.test");
    expect(screen.getAllByText("Cancelled before sending")).toHaveLength(2);
    expect(screen.getByText("Permission withdrawn")).toBeTruthy();
    expect(screen.queryByText("Queued")).toBeNull();
  });
});
