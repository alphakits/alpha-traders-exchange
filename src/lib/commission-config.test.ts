import { describe, expect, it } from "vitest";
import {
  getClientCommissionWalletForNetwork,
  getCommissionWalletConfiguration,
  resolveCommissionWalletForNetwork,
} from "@/lib/commission-config";

const ERC20_WALLET = "0x1111111111111111111111111111111111111111";
const POLYGON_WALLET = "0x2222222222222222222222222222222222222222";
const SOL_WALLET = "11111111111111111111111111111111";

function envFor(network: "ERC20" | "POLYGON" | "SOL", address: string) {
  const env: Record<string, string> = {};
  if (network === "ERC20") env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20 = address;
  if (network === "POLYGON") env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON = address;
  if (network === "SOL") env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL = address;
  return env;
}

describe("canonical commission wallet configuration", () => {
  it.each([
    ["ERC20", "Ethereum", ERC20_WALLET],
    ["POLYGON", "Polygon", POLYGON_WALLET],
    ["SOL", "Solana", SOL_WALLET],
  ] as const)("resolves %s only through its matching network-specific configuration", (network, alias, wallet) => {
    const env = envFor(network, wallet);

    expect(resolveCommissionWalletForNetwork(alias, env)).toEqual({
      available: true,
      network,
      walletAddress: wallet,
    });
  });

  it("uses a public address as the canonical server and browser destination when no server duplicate is configured", () => {
    const result = resolveCommissionWalletForNetwork("ERC20", envFor("ERC20", ERC20_WALLET));

    expect(result).toEqual({ available: true, network: "ERC20", walletAddress: ERC20_WALLET });
  });

  it("accepts an equal EVM server/public pair regardless of address casing", () => {
    const result = resolveCommissionWalletForNetwork("ERC20", {
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: ERC20_WALLET.toLowerCase(),
      ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: ERC20_WALLET.toUpperCase().replace("0X", "0x"),
    });

    expect(result).toEqual({
      available: true,
      network: "ERC20",
      walletAddress: ERC20_WALLET.toLowerCase(),
    });
  });

  it("fails closed for missing, invalid, mismatched, and unsupported network configuration", () => {
    expect(resolveCommissionWalletForNetwork("ERC20", {})).toMatchObject({
      available: false,
      network: "ERC20",
      error: expect.stringMatching(/No public commission wallet/i),
    });
    expect(resolveCommissionWalletForNetwork("ERC20", {
      ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: ERC20_WALLET,
    })).toMatchObject({
      available: false,
      network: "ERC20",
      error: expect.stringMatching(/No public commission wallet/i),
    });
    expect(resolveCommissionWalletForNetwork("POLYGON", envFor("POLYGON", "not-a-wallet"))).toMatchObject({
      available: false,
      network: "POLYGON",
      error: expect.stringMatching(/invalid/i),
    });
    expect(resolveCommissionWalletForNetwork("SOL", {
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL: SOL_WALLET,
      ALPHA_EXCHANGE_COMMISSION_WALLET_SOL: "So11111111111111111111111111111111111111112",
    })).toMatchObject({
      available: false,
      network: "SOL",
      error: expect.stringMatching(/inconsistent/i),
    });
    expect(resolveCommissionWalletForNetwork("TRC20", envFor("ERC20", ERC20_WALLET))).toMatchObject({
      available: false,
      network: null,
      error: expect.stringMatching(/only on ERC20, Polygon, or Solana/i),
    });
  });

  it("never uses the legacy generic wallet variables as a network fallback", () => {
    const env = {
      ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS: "TLegacyGenericWalletAddress",
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS: "TLegacyPublicWalletAddress",
    };

    expect(resolveCommissionWalletForNetwork("SOL", env)).toMatchObject({ available: false, network: "SOL" });
    expect(getClientCommissionWalletForNetwork("SOL", env)).toBe("");
  });

  it("returns server-safe availability without exposing a server-only address", () => {
    const configuration = getCommissionWalletConfiguration({
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: ERC20_WALLET,
      ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: ERC20_WALLET,
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON: POLYGON_WALLET,
      NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL: SOL_WALLET,
    });

    expect(configuration).toEqual({
      ERC20: { available: true, error: null },
      POLYGON: { available: true, error: null },
      SOL: { available: true, error: null },
    });
  });
});
