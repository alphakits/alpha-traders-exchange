import { describe, expect, it } from "vitest";
import { tronAddressToHex } from "@/lib/wallet-address";

describe("TRON address conversion", () => {
  it("converts a checksummed address to the event-log hex representation", () => {
    expect(tronAddressToHex("TWpyGLGFhZaJide9a2YSWMTrxRMHJ2aBsi")).toBe(
      "41e4cbd8d3cd5f10b43127324f668ad9f2e86bb79d",
    );
  });

  it("rejects a Base58 address with an invalid checksum", () => {
    expect(tronAddressToHex("TWpyGLGFhZaJide9a2YSWMTrxRMHJ2aBs1")).toBeNull();
  });
});
