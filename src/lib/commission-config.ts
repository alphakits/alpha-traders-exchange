import { getWalletAddressValidationError } from "@/lib/wallet-address";

export type CommissionNetworkId = "ERC20" | "POLYGON" | "SOL";

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

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export interface CommissionNetworkConfig {
  id: CommissionNetworkId;
  label: string;
  sublabel: string;
  token: string;
  recommended?: boolean;
  /** Public env var for client-side access */
  publicEnvVar: string;
  /** Server-side env var (never exposed to browser) */
  serverEnvVar: string;
}

export const COMMISSION_NETWORKS: CommissionNetworkConfig[] = [
  {
    id: "ERC20",
    label: "USDT (ERC20 / Ethereum)",
    sublabel: "Ethereum Mainnet",
    token: "USDT",
    recommended: true,
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
  },
  {
    id: "POLYGON",
    label: "USDT (Polygon)",
    sublabel: "Polygon Mainnet",
    token: "USDT",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON",
  },
  {
    id: "SOL",
    label: "USDT (Solana SPL)",
    sublabel: "Solana Mainnet",
    token: "USDT",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
  },
];

function normalizeCommissionNetwork(network: string) {
  const normalized = network.trim().toUpperCase();
  if (normalized === "ERC20" || normalized === "ERC-20" || normalized === "ETH" || normalized === "ETHEREUM") {
    return "ERC20" as const;
  }
  if (normalized === "POLYGON" || normalized === "MATIC") return "POLYGON" as const;
  if (normalized === "SOL" || normalized === "SOLANA") return "SOL" as const;
  return null;
}

function getConfiguredValue(env: EnvironmentValues, key: string) {
  const value = env[key]?.trim();
  return value || null;
}

function addressesMatch(network: CommissionNetworkId, left: string, right: string) {
  return network === "SOL"
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

function getAddressValidationError(network: CommissionNetworkId, address: string) {
  // Polygon uses the same EVM address format as ERC20/Ethereum.
  return getWalletAddressValidationError(network === "POLYGON" ? "ERC20" : network, address);
}

/**
 * Resolves the one canonical destination for a commission-payment rail.
 * When a server-side and public value are both configured, they must point to
 * the same address. That prevents the browser from displaying one recipient
 * while the verifier records another.
 */
export function resolveCommissionWalletForNetwork(
  network: string,
  env: EnvironmentValues = process.env,
): CommissionWalletResolution {
  const normalizedNetwork = normalizeCommissionNetwork(network);
  if (!normalizedNetwork) {
    return {
      available: false,
      network: null,
      error: "Commission payments are supported only on ERC20, Polygon, or Solana.",
    };
  }

  const config = COMMISSION_NETWORKS.find((item) => item.id === normalizedNetwork)!;
  const publicAddress = getConfiguredValue(env, config.publicEnvVar);
  const serverAddress = getConfiguredValue(env, config.serverEnvVar);

  for (const address of [publicAddress, serverAddress]) {
    if (!address) continue;
    if (getAddressValidationError(normalizedNetwork, address)) {
      return {
        available: false,
        network: normalizedNetwork,
        error: `Commission wallet configuration for ${config.label} is invalid. Please contact Alpha Traders support.`,
      };
    }
  }

  // Commission recipients are intentionally public: a seller must see the
  // exact destination before submitting a payment. A server-only value would
  // let a direct API request be verified against an address the UI cannot
  // display, so it is not a valid interactive payment configuration.
  if (!publicAddress) {
    return {
      available: false,
      network: normalizedNetwork,
      error: `No public commission wallet is configured for ${config.label}. Please contact Alpha Traders support.`,
    };
  }

  if (serverAddress && !addressesMatch(normalizedNetwork, publicAddress, serverAddress)) {
    return {
      available: false,
      network: normalizedNetwork,
      error: `Commission wallet configuration for ${config.label} is inconsistent. Please contact Alpha Traders support.`,
    };
  }

  return {
    available: true,
    network: normalizedNetwork,
    // The public address is selected so the displayed recipient and server
    // verification destination are byte-for-byte identical.
    walletAddress: publicAddress,
  };
}

/**
 * Server-safe availability data for the payment UI. It never exposes a
 * server-only address, only whether the canonical resolver can use the rail.
 */
export function getCommissionWalletConfiguration(
  env: EnvironmentValues = process.env,
): CommissionWalletConfiguration {
  return Object.fromEntries(COMMISSION_NETWORKS.map((config) => {
    const result = resolveCommissionWalletForNetwork(config.id, env);
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
  env: EnvironmentValues = process.env,
): string | null {
  const result = resolveCommissionWalletForNetwork(network, env);
  return result.available ? result.walletAddress : null;
}

/** Default network — ERC20 (Ethereum), recommended for broadest wallet support. */
export function getDefaultCommissionNetwork(): CommissionNetworkId {
  return "ERC20";
}

/**
 * Client-side wallet address map populated from NEXT_PUBLIC_ env vars.
 * Keyed by network id. Values are empty strings when not configured.
 */
export function getClientCommissionWalletForNetwork(
  network: CommissionNetworkId,
  env: EnvironmentValues = process.env,
) {
  const config = COMMISSION_NETWORKS.find((item) => item.id === network)!;
  const address = getConfiguredValue(env, config.publicEnvVar);
  return address && !getAddressValidationError(network, address) ? address : "";
}

// Keep these direct references so Next.js embeds the public configuration in
// the browser bundle. Dynamic process.env indexing is server-safe but is not
// substituted by Next's client compiler.
const CLIENT_COMMISSION_ENV: EnvironmentValues = {
  NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20,
  NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON,
  NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL,
};

export const CLIENT_COMMISSION_WALLETS: Record<CommissionNetworkId, string> = {
  ERC20: getClientCommissionWalletForNetwork("ERC20", CLIENT_COMMISSION_ENV),
  POLYGON: getClientCommissionWalletForNetwork("POLYGON", CLIENT_COMMISSION_ENV),
  SOL: getClientCommissionWalletForNetwork("SOL", CLIENT_COMMISSION_ENV),
};

