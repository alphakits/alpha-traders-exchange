// @vitest-environment node

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  getTradeEvidenceForRequest: vi.fn(),
  logEvent: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  uploadTradeEvidence: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeEvidenceForRequest: mocks.getTradeEvidenceForRequest,
  uploadTradeEvidence: mocks.uploadTradeEvidence,
}));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));
vi.mock("@/lib/runtime-safety", () => ({ allowsRuntimeDiagnostics: () => false }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { GET, POST } from "./route";

const routeContext = {
  params: Promise.resolve({ requestId: "request-1" }),
};

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("Pragma")).toBe("no-cache");
}

function readEvidenceRequest() {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests/request-1/evidence");
}

function evidenceRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests/request-1/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      side: "buyer",
      fileName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 68,
      fileData: "aGVsbG8=",
      ...overrides,
    }),
  });
}

describe("trade evidence route privacy and post-commit reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer" },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.getTradeEvidenceForRequest.mockResolvedValue({ id: "request-1", status: "payment_sent" });
    mocks.uploadTradeEvidence.mockResolvedValue({
      request: { id: "request-1", status: "payment_sent" },
      metrics: {
        dbReadMs: 1,
        validationMs: 1,
        storageMs: 1,
        dbWriteMs: 1,
        autoAdvancedToPaymentSent: true,
        autoAdvancedToUsdtSent: false,
        replayed: false,
      },
    });
  });

  it("returns the committed upload when email preparation fails", async () => {
    mocks.prepareTradeEventEmails.mockRejectedValue(new Error("email provider unavailable"));

    const response = await POST(evidenceRequest(), {
      params: Promise.resolve({ requestId: "request-1" }),
    });

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      request: { id: "request-1", status: "payment_sent" },
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "trade_lifecycle_email_schedule",
      resourceId: "request-1",
      reason: "evidence_post_commit_schedule_failed",
    }));
  });

  it("marks successful evidence reads as private and non-cacheable", async () => {
    const response = await GET(readEvidenceRequest(), routeContext);

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toEqual({
      request: { id: "request-1", status: "payment_sent" },
    });
  });

  it("marks evidence read errors as private and non-cacheable", async () => {
    mocks.getTradeEvidenceForRequest.mockRejectedValue(new Error("Trade not found."));

    const response = await GET(readEvidenceRequest(), routeContext);

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toEqual({ error: "Trade not found." });
  });

  it("marks validation failures as private and non-cacheable", async () => {
    const response = await POST(evidenceRequest({ side: "invalid" }), routeContext);

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect(mocks.uploadTradeEvidence).not.toHaveBeenCalled();
  });

  it("preserves retry metadata while preventing rate-limit responses from being cached", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });

    const response = await POST(evidenceRequest(), routeContext);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expectPrivateNoStore(response);
    expect(mocks.uploadTradeEvidence).not.toHaveBeenCalled();
  });

  it("adds privacy headers to authentication and verification rejections", async () => {
    mocks.requireApiUser.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const unauthorized = await GET(readEvidenceRequest(), routeContext);
    expect(unauthorized.status).toBe(401);
    expectPrivateNoStore(unauthorized);

    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(
      NextResponse.json({ error: "Email verification required" }, { status: 403 }),
    );
    const unverified = await POST(evidenceRequest(), routeContext);
    expect(unverified.status).toBe(403);
    expectPrivateNoStore(unverified);
  });
});
