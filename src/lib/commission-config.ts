export type CommissionNetworkId = "ERC20" | "POLYGON" | "SOL";

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

/**
 * Server-side: resolves the receiving wallet address for a given network.
 * Returns null if no address is configured for the network.
 */
export function getCommissionWalletForNetwork(network: string): string | null {
  const config = COMMISSION_NETWORKS.find((n) => n.id === network);
  if (!config) return null;
  const address =
    process.env[config.serverEnvVar] ??
    process.env[config.publicEnvVar] ??
    // Legacy single-network env var fallback (only for SOL/Phantom)
    (network === "SOL"
      ? (process.env.ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
         process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS)
      : undefined);
  return address ?? null;
}

/** Default network — ERC20 (Ethereum), recommended for broadest wallet support. */
export function getDefaultCommissionNetwork(): CommissionNetworkId {
  return "ERC20";
}

/**
 * Client-side wallet address map populated from NEXT_PUBLIC_ env vars.
 * Keyed by network id. Values are empty strings when not configured.
 */
export const CLIENT_COMMISSION_WALLETS: Record<CommissionNetworkId, string> = {
  ERC20: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20 ?? "",
  POLYGON: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_POLYGON ?? "",
  SOL:
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL ??
    // Legacy Phantom wallet fallback
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
    "",
};

