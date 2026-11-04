type Runtime = Readonly<Record<string, string | undefined>>;

/** This first implementation has no deployment, testnet, mainnet, or signer mode. */
export function assertSimulationRuntime(mode: string | undefined, runtime: Runtime = process.env) {
  if (mode !== "simulation-only") throw new Error("Alpha Wallet development is disabled without explicit simulation-only opt-in");
  if (runtime.NODE_ENV !== "development" && runtime.NODE_ENV !== "test") throw new Error("Alpha Wallet simulation requires a local development or test runtime");
  if (runtime.VERCEL || runtime.VERCEL_ENV || runtime.AWS_LAMBDA_FUNCTION_NAME || runtime.CF_PAGES || runtime.K_SERVICE) {
    throw new Error("Alpha Wallet simulation refuses hosted runtimes");
  }
  if (runtime.ALPHA_WALLET_MAINNET_ENABLED || runtime.ALPHA_WALLET_SIGNING_ENABLED) {
    throw new Error("Alpha Wallet development cannot enable mainnet or signing");
  }
}
