import { z } from "zod";
import { walletDigest, type ResultOf, type WalletCommand } from "./commands";
import { v2CheckpointSchema, type V2Command, type V2ResultOf } from "./v2-commands";
import {
  parseV3VersionedCommand, v3InitialTermsSchema, type V3Command, type V3ResultOf, type V3VersionedCommand,
} from "./v3-commands";
import type { V4Continuation, V4InitialCancellationReceipt } from "./v4-engine";

/** A closed cancellation envelope. No previous envelope acquires lifecycle authority. */
export const WALLET_V4_ENGINE_VERSION = "alpha-wallet-simulation-v4" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
// Canonical decisions use exact millisecond timestamps. Matching SQL precision
// avoids a JS Date/SQL rounding disagreement at the expiry or update boundary.
const timestamp = z.string().datetime({ offset: true, precision: 3 }).refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > 0);
const asset = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const actor = z.strictObject({ kind: z.enum(["seller", "buyer", "operator", "verifier", "dispatcher"]), id });

export const v4OriginalAcceptanceSchema = z.strictObject({
  acceptanceKey: hex, commandRevision: safe, commandKey: z.string().min(1).max(400), receiptDigest: hex, bindingDigest: hex,
});
/**
 * These are bounded recorded facts, not authentication or database-read proof.
 * The separate canonical coordinator must derive them from locked current rows.
 */
export const v4CancellationPreconditionsSchema = z.strictObject({
  requestUpdatedAt: timestamp, requestDigest: hex, listingDigest: hex, tradeDigest: hex, marketplaceDigest: hex,
  listingExpiresAt: timestamp.nullable(), canonicalPrepayment: z.literal(true), canonicalTermsUnchanged: z.literal(true),
  buyerBankDetailsDisclosed: z.boolean(), walletRevision: safe, walletEventHash: hex, walletStateDigest: hex,
  walletTradeDigest: hex, walletListingDigest: hex,
});
export const v4PrincipalReturnSchema = z.strictObject({
  action: z.literal("return_to_listing"), assetId: asset, walletListingId: id, walletTradeId: id,
  principalRaw: raw, transferAmountRaw: raw, fromAccount: z.string().min(1).max(100), toAccount: z.string().min(1).max(100),
  expectedListingAvailableRaw: raw, expectedTradeReservedRaw: raw,
});
export const v4CancellationInputSchema = z.strictObject({
  cancellationKey: hex, terms: v3InitialTermsSchema, termsDigest: hex, originalAcceptance: v4OriginalAcceptanceSchema,
  cancelledAtMs: safe, preconditions: v4CancellationPreconditionsSchema, principalReturn: v4PrincipalReturnSchema,
  plannerInputDigest: hex,
});
export type V4InitialCancellationInput = z.infer<typeof v4CancellationInputSchema>;

const common = { version: z.literal(4), engineVersion: z.literal(WALLET_V4_ENGINE_VERSION), actor, requestId: id };
export const v4CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("continueFromV3"), input: z.strictObject({ checkpoint: v2CheckpointSchema }) }),
  z.strictObject({ ...common, type: z.literal("cancelInitialTrade"), input: v4CancellationInputSchema }),
  z.strictObject({ ...common, type: z.literal("pause"), input: z.null() }),
]);
export type V4Command = z.infer<typeof v4CommandSchema>;
export type V4CommandType = V4Command["type"];
export type V4CommandOf<T extends V4CommandType> = Extract<V4Command, { type: T }>;
export type V4ResultOf<T extends V4CommandType> = T extends "continueFromV3" ? V4Continuation
  : T extends "cancelInitialTrade" ? V4InitialCancellationReceipt : { halted: true };
export type V4VersionedCommand = V3VersionedCommand | V4Command;
export type V4VersionedResultOf<C extends V4VersionedCommand> = C extends WalletCommand ? ResultOf<C["type"]>
  : C extends V2Command ? V2ResultOf<C["type"]> : C extends V3Command ? V3ResultOf<C["type"]>
    : C extends V4Command ? V4ResultOf<C["type"]> : never;

export function parseV4Command(value: unknown): V4Command {
  const parsed = v4CommandSchema.parse(value);
  return v4CommandSchema.parse(JSON.parse(JSON.stringify(parsed)));
}
export function parseV4VersionedCommand(value: unknown): V4VersionedCommand {
  return value && typeof value === "object" && (value as { version?: unknown }).version === 4
    ? parseV4Command(value) : parseV3VersionedCommand(value);
}
/** The transport identity stays global across all four versions. */
export function v4CommandKey(command: V4VersionedCommand) {
  return JSON.stringify([command.actor.kind, command.actor.id, command.type, command.requestId]);
}
export function v4Command<T extends V4CommandType>(type: T, actor: V4Command["actor"], requestId: string, input: V4CommandOf<T>["input"]): V4CommandOf<T> {
  return parseV4Command({ version: 4, engineVersion: WALLET_V4_ENGINE_VERSION, type, actor, requestId, input }) as V4CommandOf<T>;
}
/** One terminal business outcome for an original acceptance, independent of caller or transport retry. */
export function v4CancellationKey(platformRequestId: string, acceptanceKey: string) {
  return walletDigest(["alpha-wallet-initial-cancellation-v1", platformRequestId, acceptanceKey]);
}
export function cancellationPlannerDigest(input: V4InitialCancellationInput, actorUserId: string) {
  const { plannerInputDigest: _plannerInputDigest, ...facts } = input;
  void _plannerInputDigest;
  return walletDigest({ actorUserId, input: facts });
}
