import { getWalletAddressValidationError } from "@/lib/wallet-address";

export type CommissionNetworkId = "TRC20";

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
 * Commission recipients are public by design. Keeping one code-level address
 * makes the browser, API verifier, mobile app, and production build use the
 * exact same destination without an environment-variable split-brain risk.
 */
export const CANONICAL_TRC20_COMMISSION_WALLET = "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8";

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
];

function normalizeCommissionNetwork(network: string) {
  const normalized = network.trim().toUpperCase();
  if (normalized === "TRC20" || normalized === "TRC-20" || normalized === "TRON" || normalized === "TRX") {
    return "TRC20" as const;
  }
  return null;
}

function getAddressValidationError(network: CommissionNetworkId, address: string) {
  return getWalletAddressValidationError(network, address);
}

/**
 * Resolves the only destination accepted for new commission payments.
 */
export function resolveCommissionWalletForNetwork(
  network: string,
): CommissionWalletResolution {
  const normalizedNetwork = normalizeCommissionNetwork(network);
  if (!normalizedNetwork) {
    return {
      available: false,
      network: null,
      error: "All new Alpha Traders commission payments must use USDT on TRON (TRC20).",
    };
  }

  const config = COMMISSION_NETWORKS.find((item) => item.id === normalizedNetwork)!;
  if (getAddressValidationError(normalizedNetwork, CANONICAL_TRC20_COMMISSION_WALLET)) {
    return {
      available: false,
      network: normalizedNetwork,
      error: `Commission wallet configuration for ${config.label} is invalid. Please contact Alpha Traders support.`,
    };
  }

  return {
    available: true,
    network: normalizedNetwork,
    walletAddress: CANONICAL_TRC20_COMMISSION_WALLET,
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
  return network === "TRC20" && !getAddressValidationError(network, CANONICAL_TRC20_COMMISSION_WALLET)
    ? CANONICAL_TRC20_COMMISSION_WALLET
    : "";
}

export const CLIENT_COMMISSION_WALLETS: Record<CommissionNetworkId, string> = {
  TRC20: getClientCommissionWalletForNetwork("TRC20"),
};
