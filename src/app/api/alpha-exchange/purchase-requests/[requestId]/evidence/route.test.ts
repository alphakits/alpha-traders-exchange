// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  logEvent: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireApiUser: vi.fn(),
  uploadTradeEvidence: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: () => null,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeEvidenceForRequest: vi.fn(),
  uploadTradeEvidence: mocks.uploadTradeEvidence,
}));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/runtime-safety", () => ({ allowsRuntimeDiagnostics: () => false }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST } from "./route";

function evidenceRequest() {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests/request-1/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      side: "buyer",
      fileName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 68,
      fileData: "aGVsbG8=",
    }),
  });
}

describe("trade evidence route post-commit reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer" },
      unauthorized: null,
    });
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
});
