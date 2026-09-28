import { describe, expect, it } from "vitest";
import { formatCardlessWithdrawalPayload, localizeCardlessWithdrawalMessage, parseCardlessWithdrawalDetails } from "@alpha-traders/contracts";

describe("bank withdrawal details", () => {
  it("normalizes Arabic digits while preserving leading zeros", () => {
    expect(parseCardlessWithdrawalDetails({ withdrawalCode: "٠٤٨٢٩١", verificationKind: "id_number", verificationValue: "٠١٢٣٤٥٦٧٨" })).toEqual({
      ok: true, details: { withdrawalCode: "048291", verificationKind: "id_number", verificationValue: "012345678" },
    });
  });

  it.each([undefined, "", "not-a-kind"])("rejects a missing or unsupported secondary detail type: %s", (verificationKind) => {
    expect(parseCardlessWithdrawalDetails({ withdrawalCode: "482913", verificationKind, verificationValue: "012345678" }).ok).toBe(false);
  });

  it.each(["", "31/02/1990", "1990-02-31", "01/01/2999", "01/01/1800"])("rejects invalid bank birth dates: %s", (verificationValue) => {
    expect(parseCardlessWithdrawalDetails({ withdrawalCode: "482913", verificationKind: "date_of_birth", verificationValue }).ok).toBe(false);
  });

  it("normalizes day-first and ISO dates to the same payload for retries", () => {
    const input = { withdrawalCode: "482913", verificationKind: "date_of_birth" };
    const first = parseCardlessWithdrawalDetails({ ...input, verificationValue: "29/02/1992" });
    expect(first).toEqual(parseCardlessWithdrawalDetails({ ...input, verificationValue: "1992-02-29" }));
    expect(first.ok).toBe(true);
    if (first.ok) expect(localizeCardlessWithdrawalMessage(formatCardlessWithdrawalPayload(JSON.stringify(first.details)), "ar"))
      .toBe("رمز السحب دون بطاقة: 482913\nتاريخ الميلاد (يوم/شهر/سنة): 29/02/1992");
  });

  it("keeps existing protected codes readable and hides malformed payloads", () => {
    expect(formatCardlessWithdrawalPayload("482913")).toBe("Cardless withdrawal code: 482913");
    expect(formatCardlessWithdrawalPayload('{"withdrawalCode":"secret"}')).not.toContain("secret");
  });
});
