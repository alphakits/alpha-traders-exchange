import { describe, expect, it } from "vitest";
import { sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import { getWalletAddressValidationError, normalizeWalletAddress } from "@/lib/wallet-address";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const TRON_ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";
const SOLANA_ADDRESS = "11111111111111111111111111111111";

describe("wallet address validation", () => {
  it("accepts structurally valid addresses for every supported network", () => {
    expect(getWalletAddressValidationError("TRC20", TRON_ADDRESS)).toBeNull();
    expect(getWalletAddressValidationError("ERC20", EVM_ADDRESS)).toBeNull();
    expect(getWalletAddressValidationError("BEP20", EVM_ADDRESS)).toBeNull();
    expect(getWalletAddressValidationError("SOL", SOLANA_ADDRESS)).toBeNull();
  });

  it("rejects addresses for the wrong network and normalizes whitespace", () => {
    expect(getWalletAddressValidationError("TRC20", EVM_ADDRESS)).toMatch(/TRC20/);
    expect(getWalletAddressValidationError("TRC20", `${TRON_ADDRESS.slice(0, -1)}F`)).toMatch(/TRC20/);
    expect(getWalletAddressValidationError("ERC20", TRON_ADDRESS)).toMatch(/ERC20/);
    expect(normalizeWalletAddress(`  ${TRON_ADDRESS}\n`)).toBe(TRON_ADDRESS);
  });
});

describe("receiving wallet privacy", () => {
  const request = {
    id: "request-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "accepted",
    buyerReceivingWalletAddress: TRON_ADDRESS,
  } as PurchaseRequest;

  it("keeps the wallet visible to the buyer but hidden from an accepted seller", () => {
    expect(sanitizePurchaseRequestForActor(request, "buyer-1", "buyer").buyerReceivingWalletAddress).toBe(TRON_ADDRESS);
    expect(sanitizePurchaseRequestForActor(request, "seller-1", "approved_seller").buyerReceivingWalletAddress).toBeUndefined();
  });

  it("reveals the wallet to the seller only after seller confirms funds", () => {
    const paymentSent = { ...request, status: "payment_sent" as const };
    expect(sanitizePurchaseRequestForActor(paymentSent, "seller-1", "approved_seller").buyerReceivingWalletAddress).toBeUndefined();

    const fundsReceived = { ...request, status: "funds_received" as const };
    expect(sanitizePurchaseRequestForActor(fundsReceived, "seller-1", "approved_seller").buyerReceivingWalletAddress).toBe(TRON_ADDRESS);
  });

  it("redacts the buyer phone from sellers while retaining it for the buyer", () => {
    const requestWithPhone = { ...request, buyerWhatsapp: "+972500000001" } as PurchaseRequest;
    expect(sanitizePurchaseRequestForActor(requestWithPhone, "seller-1", "approved_seller").buyerWhatsapp).toBeUndefined();
    expect(sanitizePurchaseRequestForActor(requestWithPhone, "buyer-1", "buyer").buyerWhatsapp).toBe("+972500000001");
  });
});
