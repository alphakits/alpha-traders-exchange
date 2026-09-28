import type { MobileAuthTokens } from "@alpha-traders/contracts";

export type MobileSessionSnapshot = {
  generation: number;
  tokens: MobileAuthTokens;
};

export type MobileSessionRecoveryDecision =
  | { action: "refresh"; tokens: MobileAuthTokens }
  | { action: "retry"; tokens: MobileAuthTokens }
  | { action: "superseded" };

export function resolveMobileSessionRecovery(
  failed: MobileSessionSnapshot,
  current: MobileSessionSnapshot | null,
): MobileSessionRecoveryDecision {
  if (!current || current.generation !== failed.generation) {
    return { action: "superseded" };
  }
  if (current.tokens.refreshToken !== failed.tokens.refreshToken) {
    return { action: "retry", tokens: current.tokens };
  }
  return { action: "refresh", tokens: failed.tokens };
}

export function canCommitMobileSessionRefresh(
  source: MobileSessionSnapshot,
  current: MobileSessionSnapshot | null,
) {
  return Boolean(
    current
      && current.generation === source.generation
      && current.tokens.refreshToken === source.tokens.refreshToken,
  );
}
