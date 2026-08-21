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
});