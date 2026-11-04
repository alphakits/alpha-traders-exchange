import { type ResultOf, type WalletCommand } from "./commands";
import type { DurableExecution, DurableWallet } from "./durable";
import type { FileFakeProvider } from "./fake-provider";
import { createSimulationPayoutWorker } from "./payout-worker";
import { assertSimulationRuntime } from "./runtime";
import { parseV2Command, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import type { VersionedDurableWallet } from "./versioned-durable";

/**
 * Explicit offline worker for an already upgraded ledger. Keep the proven
 * claim-before-submit / original-reference recovery algorithm unchanged, while
 * issuing inherited commands under the v2 envelope. This neither upgrades a
 * store nor registers a service, timer, route, signer or network provider.
 */
export function createVersionedSimulationPayoutWorker(options: {
  mode: "simulation-only";
  wallet: VersionedDurableWallet;
  provider: FileFakeProvider;
}) {
  assertSimulationRuntime(options.mode);
  async function snapshot() {
    assertSimulationRuntime(options.mode);
    const current = await options.wallet.snapshot();
    assertSimulationRuntime(options.mode);
    if (current.engineVersion !== WALLET_V2_ENGINE_VERSION) {
      throw new Error("Versioned payout worker requires an explicitly upgraded v2 ledger");
    }
    return { revision: current.revision, eventHash: current.eventHash, state: current.state };
  }
  const inherited: DurableWallet = {
    snapshot,
    async execute<C extends WalletCommand>(input: C): Promise<DurableExecution<ResultOf<C["type"]>>> {
      assertSimulationRuntime(options.mode);
      const command = parseV2Command({ ...input, version: 2, engineVersion: WALLET_V2_ENGINE_VERSION });
      // The adapter only changes the envelope version. Strict parsing retains
      // the original command type/input, and inherited v2 results retain the
      // existing result contract. No caller-selected method is executed here.
      return await options.wallet.execute(command) as DurableExecution<ResultOf<C["type"]>>;
    },
    async recoverPayouts() {
      await snapshot();
      return options.wallet.recoverPayouts();
    },
  };
  return createSimulationPayoutWorker({ mode: options.mode, wallet: inherited, provider: options.provider });
}
