export type CommissionNetworkId = "TRC20" | "ERC20" | "BEP20" | "SOL";

export interface CommissionNetworkConfig {
  id: CommissionNetworkId;
  label: string;
  token: string;
  /** Server-side env var (never exposed to browser) */
  serverEnvVar: string;
  /** Public env var for client-side access */
  publicEnvVar: string;
}

export const COMMISSION_NETWORKS: CommissionNetworkConfig[] = [
  {
    id: "TRC20",
    label: "TRC20 (Tron)",
    token: "USDT",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_TRC20",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_TRC20",
  },
  {
    id: "ERC20",
    label: "ERC20 (Ethereum)",
    token: "USDT",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20",
  },
  {
    id: "BEP20",
    label: "BEP20 (BSC)",
    token: "USDT",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_BEP20",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_BEP20",
  },
  {
    id: "SOL",
    label: "Solana SPL",
    token: "USDT",
    serverEnvVar: "ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
    publicEnvVar: "NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL",
  },
];

/**
 * Server-side: resolves the receiving wallet address for a given network.
 * Reads private env vars first, then falls back to public env vars.
 * Returns null if no address is configured for the network.
 */
export function getCommissionWalletForNetwork(network: string): string | null {
  const config = COMMISSION_NETWORKS.find((n) => n.id === network);
  if (!config) return null;
  const address =
    process.env[config.serverEnvVar] ??
    process.env[config.publicEnvVar] ??
    // Legacy single-network env var fallback
    process.env.ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS;
  return address ?? null;
}

/**
 * Returns the default network to show when the modal first opens.
 * Prefers TRC20 (cheapest fees), falls back to any configured network.
 */
export function getDefaultCommissionNetwork(): CommissionNetworkId {
  return "TRC20";
}

/**
 * Client-side wallet address map populated from NEXT_PUBLIC_ env vars.
 * Keyed by network id. Values are empty strings when not configured.
 */
export const CLIENT_COMMISSION_WALLETS: Record<CommissionNetworkId, string> = {
  TRC20: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_TRC20 ?? "",
  ERC20: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ERC20 ?? "",
  BEP20: process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_BEP20 ?? "",
  SOL:
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_SOL ??
    // Legacy single-wallet fallback (Phantom address)
    process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_COMMISSION_WALLET_ADDRESS ??
    "",
};
