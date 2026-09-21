import { getWalletAddressValidationError } from "@/lib/wallet-address";

export type CommissionNetworkId = "TRC20" | "BEP20";

export type CommissionWalletResolution =
  | {
    available: true;
    network: CommissionNetworkId;
    walletAddress: string;
  }
  | {
    available: false;
    network: CommissionNetworkId | null;
    error: string;
  };

export type CommissionWalletConfiguration = Record<CommissionNetworkId, {
  available: boolean;
  error: string | null;
}>;

export interface CommissionNetworkConfig {
  id: CommissionNetworkId;
  label: string;
  sublabel: string;
  token: string;
  recommended?: boolean;
}

/**
 * Commission recipients are public by design. Keeping one code-level address per network
 * makes the browser, API verifier, mobile app, and production build use the
 * exact same destination without an environment-variable split-brain risk.
 */
export const CANONICAL_TRC20_COMMISSION_WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";

export const CANONICAL_BEP20_COMMISSION_WALLET = "0x7088a120cde7351dbf3e7831a9da3f74058c89a0";
/** Binance-Peg USDT on BNB Smart Chain, 18 decimals. */
export const BSC_USDT_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";

/** Official Tether USD contract on TRON mainnet. */
export const OFFICIAL_TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const COMMISSION_NETWORKS: CommissionNetworkConfig[] = [
  {
    id: "TRC20",
    label: "USDT (TRC20 / TRON)",
    sublabel: "TRON Mainnet",
    token: "USDT",
    recommended: true,
  },
  { id: "BEP20", label: "USDT (BEP20 / BNB Smart Chain)", sublabel: "BNB Smart Chain Mainnet", token: "USDT" },
];

function normalizeCommissionNetwork(network: string) {
  const normalized = network.trim().toUpperCase();
  if (normalized === "TRC20" || normalized === "TRC-20" || normalized === "TRON" || normalized === "TRX") {
    return "TRC20" as const;
  }
  if (["BEP20", "BEP-20", "BSC"].includes(normalized)) return "BEP20" as const;
  return null;
}

function getAddressValidationError(network: CommissionNetworkId, address: string) {
  return getWalletAddressValidationError(network, address);
}

/**
 * Resolves the canonical destination for the selected commission network.
 */
export function resolveCommissionWalletForNetwork(
  network: string,
): CommissionWalletResolution {
  const normalizedNetwork = normalizeCommissionNetwork(network);
  if (!normalizedNetwork) {
    return {
      available: false,
      network: null,
      error: "Commission payments must use USDT on TRON (TRC20) or BNB Smart Chain (BEP20).",
    };
  }

  const walletAddress = normalizedNetwork === "BEP20" ? CANONICAL_BEP20_COMMISSION_WALLET : CANONICAL_TRC20_COMMISSION_WALLET;
  const config = COMMISSION_NETWORKS.find((item) => item.id === normalizedNetwork)!;
  if (getAddressValidationError(normalizedNetwork, walletAddress)) {
    return {
      available: false,
      network: normalizedNetwork,
      error: `Commission wallet configuration for ${config.label} is invalid. Please contact Alpha Traders support.`,
    };
  }

  return {
    available: true,
    network: normalizedNetwork,
    walletAddress,
  };
}

/**
 * Availability data for the payment UI.
 */
export function getCommissionWalletConfiguration(
): CommissionWalletConfiguration {
  return Object.fromEntries(COMMISSION_NETWORKS.map((config) => {
    const result = resolveCommissionWalletForNetwork(config.id);
    return [config.id, {
      available: result.available,
      error: result.available ? null : result.error,
    }];
  })) as CommissionWalletConfiguration;
}

/**
 * Server-side: resolves the receiving wallet address for a given network.
 * Returns null if no address is configured for the network.
 */
export function getCommissionWalletForNetwork(
  network: string,
): string | null {
  const result = resolveCommissionWalletForNetwork(network);
  return result.available ? result.walletAddress : null;
}

/** Default network — TRC20 (TRON), the canonical Alpha Traders commission rail. */
export function getDefaultCommissionNetwork(): CommissionNetworkId {
  return "TRC20";
}

/**
 * Client-side wallet address map keyed by the current commission network.
 */
export function getClientCommissionWalletForNetwork(
  network: CommissionNetworkId,
) {
  const resolved = resolveCommissionWalletForNetwork(network);
  return resolved.available ? resolved.walletAddress : "";
}

export const CLIENT_COMMISSION_WALLETS: Record<CommissionNetworkId, string> = {
  TRC20: getClientCommissionWalletForNetwork("TRC20"),
  BEP20: getClientCommissionWalletForNetwork("BEP20"),
};
