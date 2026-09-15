import { describe, expect, it } from "vitest";
import {
  CANONICAL_TRC20_COMMISSION_WALLET,
  CLIENT_COMMISSION_WALLETS,
  COMMISSION_NETWORKS,
  OFFICIAL_TRON_USDT_CONTRACT,
  getClientCommissionWalletForNetwork,
  getCommissionWalletConfiguration,
  getDefaultCommissionNetwork,
  resolveCommissionWalletForNetwork,
} from "@/lib/commission-config";

const BINANCE_TRC20_WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";
const OFFICIAL_USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("canonical commission wallet configuration", () => {
  it("locks every new commission payment surface to the exact Binance TRC20 address", () => {
    expect(CANONICAL_TRC20_COMMISSION_WALLET).toBe(BINANCE_TRC20_WALLET);
    expect(CLIENT_COMMISSION_WALLETS).toEqual({ TRC20: BINANCE_TRC20_WALLET });
    expect(getClientCommissionWalletForNetwork("TRC20")).toBe(BINANCE_TRC20_WALLET);
    expect(COMMISSION_NETWORKS).toEqual([
      expect.objectContaining({ id: "TRC20", token: "USDT", recommended: true }),
    ]);
  });

  it("locks commission verification to the official Tether contract on TRON mainnet", () => {
    expect(OFFICIAL_TRON_USDT_CONTRACT).toBe(OFFICIAL_USDT_TRC20_CONTRACT);
  });

  it.each(["TRC20", "TRC-20", "TRON", "TRX"])("resolves the %s alias to the canonical wallet", (network) => {
    expect(resolveCommissionWalletForNetwork(network)).toEqual({
      available: true,
      network: "TRC20",
      walletAddress: BINANCE_TRC20_WALLET,
    });
  });

  it.each(["ERC20", "POLYGON", "SOL", "BEP20", ""])("rejects the legacy or unsupported %s rail for new payments", (network) => {
    expect(resolveCommissionWalletForNetwork(network)).toMatchObject({
      available: false,
      network: null,
      error: expect.stringMatching(/must use USDT on TRON \(TRC20\)/i),
    });
  });

  it("returns one available payment configuration and defaults to TRC20", () => {
    expect(getCommissionWalletConfiguration()).toEqual({
      TRC20: { available: true, error: null },
    });
    expect(getDefaultCommissionNetwork()).toBe("TRC20");
  });
});
