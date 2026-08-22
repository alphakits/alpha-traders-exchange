import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "@/lib/structured-logging";

describe("structured logging privacy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts phone numbers and financial metadata before logging", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logEvent("warn", {
      event: "security_test",
      outcome: "denied",
      reason: "Provider rejected +972 50-123-4567",
      metadata: {
        buyerWhatsapp: "+972501234567",
        bankAccountNumber: "1234567890",
        nested: { message: "Call 050-987-6543" },
      },
    });

    const payload = log.mock.calls[0]?.[1] as { reason: string; metadata: Record<string, unknown> };
    expect(payload.reason).toContain("[private contact removed]");
    expect(payload.metadata.buyerWhatsapp).toBe("[REDACTED]");
    expect(payload.metadata.bankAccountNumber).toBe("[REDACTED]");
    expect(payload.metadata.nested).toEqual({ message: "Call [private contact removed]" });
  });

  it("redacts email, IP, session, wallet, transaction, and request payload fields", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logEvent("error", {
      event: "security_test",
      outcome: "failed",
      reason: "unexpected_failure",
      metadata: {
        email: "person@example.com",
        clientIp: "203.0.113.10",
        sessionId: "session-value",
        authorization: "Bearer test-value",
        walletAddress: "wallet-value",
        transactionHash: "transaction-value",
        requestBody: { password: "should-not-log" },
      },
    });

    const payload = log.mock.calls[0]?.[1] as { metadata: Record<string, unknown> };
    expect(payload.metadata).toEqual({
      email: "[REDACTED]",
      clientIp: "[REDACTED]",
      sessionId: "[REDACTED]",
      authorization: "[REDACTED]",
      walletAddress: "[REDACTED]",
      transactionHash: "[REDACTED]",
      requestBody: "[REDACTED]",
    });
  });

  it("redacts sensitive values embedded in freeform failure reasons", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logEvent("warn", {
      event: "security_test",
      outcome: "failed",
      reason: "Provider rejected person@example.com from 203.0.113.42 with Bearer value",
    });

    const payload = log.mock.calls[0]?.[1] as { reason: string };
    expect(payload.reason).not.toContain("person@example.com");
    expect(payload.reason).not.toContain("203.0.113.42");
    expect(payload.reason).not.toContain("Bearer value");
  });
});
