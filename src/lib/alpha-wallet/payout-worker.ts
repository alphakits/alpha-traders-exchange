import { walletDigest } from "./commands";
import { walletCommand, type DurableWallet } from "./durable";
import { assertSimulationRuntime } from "./runtime";
import type { FileFakeProvider, FakeLookup } from "./fake-provider";
import type { Actor, Payout } from "./types";

const DISPATCHER: Actor = { kind: "dispatcher", id: "durable-simulation-worker" };
const VERIFIER: Actor = { kind: "verifier", id: "durable-simulation-verifier" };
const request = (operation: string, identity: unknown) => `${operation}-${walletDigest(identity).slice(0, 48)}`;
export type WorkerResult = { payoutId: string; status: "confirmed" | "failed_final" | "broadcast" | "submission_unknown" | "held_by_policy" | "provider_lookup_required" };

/** One explicit offline step; no cron, loop, network client, or production registration. */
export function createSimulationPayoutWorker(options: { mode: "simulation-only"; wallet: DurableWallet; provider: FileFakeProvider }) {
  assertSimulationRuntime(options.mode);
  if (options.provider.kind !== "alpha-wallet-file-fake-provider") throw new Error("Only the offline fake provider is supported");
  const result = (payout: Payout, status: WorkerResult["status"]): WorkerResult => ({ payoutId: payout.id, status });
  async function currentKnownOutcome(payout: Payout, expectedTransaction?: string) {
    const saved = (await options.wallet.snapshot()).state.payouts.get(payout.id);
    if (!saved || saved.providerReference !== payout.providerReference || saved.assetId !== payout.assetId
      || saved.destination !== payout.destination || saved.amountRaw !== payout.amountRaw) throw new Error("Recovered payout identity changed");
    if (!saved.transactionId || (expectedTransaction && saved.transactionId !== expectedTransaction)) return null;
    if (saved.state === "broadcast" || saved.state === "confirmed" || saved.state === "failed_final") return result(saved, saved.state);
    return null;
  }
  async function recordKnown(payout: Payout, found: Exclude<FakeLookup, { status: "not_found" }>) {
    if (found.status === "finalized") {
      const confirmed = await options.wallet.execute(walletCommand("confirmPayout", VERIFIER, request("confirm", found.receipt), found.receipt));
      return result(confirmed.result, confirmed.result.state === "confirmed" ? "confirmed" : "failed_final");
    }
    if (payout.state === "submitting" || payout.state === "submission_unknown") {
      try {
        await options.wallet.execute(walletCommand("recordSubmission", DISPATCHER, request("broadcast", [payout.id, found.record.transactionId]), {
          payoutId: payout.id, outcome: "broadcast", transactionId: found.record.transactionId,
        }));
      } catch (error) {
        // Another worker may have confirmed after our lookup. Accept only a
        // verified current outcome for the SAME immutable intent and transaction.
        const latest = await currentKnownOutcome(payout, found.record.transactionId);
        if (latest) return latest;
        throw error;
      }
    } else if (payout.transactionId !== found.record.transactionId) {
      throw new Error("Recovered provider transaction differs from original submission");
    }
    const latest = await currentKnownOutcome(payout, found.record.transactionId);
    if (!latest) throw new Error("Known provider result has no matching durable outcome");
    return latest;
  }
  return Object.freeze({
    async step(payoutId: string): Promise<WorkerResult> {
      assertSimulationRuntime(options.mode);
      const snapshot = await options.wallet.snapshot(), payout = snapshot.state.payouts.get(payoutId);
      if (!payout) throw new Error("Payout not found");
      if (payout.state === "confirmed" || payout.state === "failed_final") return result(payout, payout.state);
      if (payout.state !== "queued") {
        // An unresolved committed claim can only look up its ORIGINAL provider reference.
        // Not-found is not proof of failure and never authorizes another submission.
        const found = await options.provider.lookup(payout);
        return found.status === "not_found" ? result(payout, "provider_lookup_required") : recordKnown(payout, found);
      }
      if (snapshot.state.haltReason || (payout.tradeId && snapshot.state.trades.get(payout.tradeId)?.disputed)) return result(payout, "held_by_policy");
      // A rejected/unknown database COMMIT propagates here: the provider is never called.
      const claim = await options.wallet.execute(walletCommand("beginDispatch", DISPATCHER, request("claim", payoutId), payoutId));
      if (!claim.result.shouldDispatch) {
        const found = await options.provider.lookup(claim.result.payout);
        return found.status === "not_found" ? result(payout, "provider_lookup_required") : recordKnown(claim.result.payout, found);
      }
      let accepted;
      try { accepted = await options.provider.submit(claim.result.payout); }
      catch {
        try {
          await options.wallet.execute(walletCommand("recordSubmission", DISPATCHER, request("unknown", payoutId), { payoutId, outcome: "unknown" }));
        } catch (error) {
          const latest = await currentKnownOutcome(payout);
          if (latest) return latest;
          throw error;
        }
        return await currentKnownOutcome(payout) ?? result(payout, "submission_unknown");
      }
      return recordKnown(claim.result.payout, { status: "broadcast", record: accepted });
    },
  });
}
