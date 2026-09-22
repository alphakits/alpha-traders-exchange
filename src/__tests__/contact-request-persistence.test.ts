import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
  getRuntimePostgresPool: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: mocks.getRuntimePostgresPool }));

import { POST } from "@/app/api/contact/route";

const deletionRequest = {
  name: "Review Test User",
  email: "review+deletion@example.test",
  subject: "Alpha Traders account deletion request",
  message: "I request deletion of my test account and its associated data.",
  locale: "en",
  website: "",
};

function makeRequest() {
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deletionRequest),
  });
}

describe("support and account deletion request persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getRuntimePostgresPool.mockReturnValue({ query: mocks.query });
  });

  it("does not acknowledge or log private request content when storage is unavailable", async () => {
    mocks.getRuntimePostgresPool.mockReturnValue(null);

    const response = await POST(makeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledExactlyOnceWith("error", {
      event: "contact_submission",
      outcome: "failed",
      reason: "no_db_configured",
      metadata: { locale: "en" },
    });
  });

  it("does not report receipt when the database rejects the write", async () => {
    mocks.query.mockRejectedValue(new Error("storage unavailable"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(mocks.logEvent).not.toHaveBeenCalledWith("info", expect.anything());
  });

  it("acknowledges the request only after it is saved, preserving the email alias", async () => {
    let finishWrite!: () => void;
    mocks.query.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    let acknowledged = false;
    const responsePromise = POST(makeRequest()).then((response) => {
      acknowledged = true;
      return response;
    });

    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledOnce());
    expect(acknowledged).toBe(false);
    expect(mocks.logEvent).not.toHaveBeenCalledWith("info", expect.anything());
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.contact_submissions"), [
      deletionRequest.name,
      deletionRequest.email,
      deletionRequest.subject,
      deletionRequest.message,
      deletionRequest.locale,
      expect.stringMatching(/^[a-f0-9]{16}$/),
    ]);

    finishWrite();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
