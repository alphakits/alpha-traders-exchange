import { createHash } from "node:crypto";
import { z } from "zod";
import type { AlphaWalletSandbox } from "./sandbox";

export const WALLET_ENGINE_VERSION = "alpha-wallet-simulation-v1" as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = z.string().min(1).max(250);
const amount = z.string().min(1).max(100);
const raw = z.string().regex(/^(?:0|[1-9]\d{0,77})$/);
const assetId = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
const actor = z.strictObject({ kind: z.enum(["seller", "buyer", "operator", "verifier", "dispatcher"]), id });
const common = { version: z.literal(1), engineVersion: z.literal(WALLET_ENGINE_VERSION), actor, requestId: id };
const envelope = <T extends string, S extends z.ZodType>(type: T, input: S) => z.strictObject({ ...common, type: z.literal(type), input });
const event = { assetId, network: text, token: text, transactionId: text, eventIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  destination: text, amountRaw: raw, finalized: z.boolean(), successful: z.boolean() };

export const walletCommandSchema = z.discriminatedUnion("type", [
  envelope("createDepositIntent", z.strictObject({ id, assetId, purpose: z.enum(["principal", "commission"]) })),
  envelope("observeDeposit", z.strictObject({ ...event, intentId: id, blockHash: text })),
  envelope("createListing", z.strictObject({ id, assetId, amount, price: amount, currency: z.literal("ILS") })),
  envelope("approveListing", id), envelope("closeListing", id),
  envelope("reserveTrade", z.strictObject({ id, listingId: id, amount, destination: text })),
  envelope("markBuyerPaid", id),
  envelope("verifyPayment", z.strictObject({ tradeId: id, evidence: z.strictObject({ reference: text, amountMinor: raw,
    currency: z.literal("ILS"), kind: z.enum(["simulated-bank-credit", "simulated-cash-receipt"]) }) })),
  envelope("authorizeRelease", id), envelope("queueRelease", id), envelope("cancelTrade", id), envelope("openDispute", id),
  envelope("requestWithdrawal", z.strictObject({ id, assetId, amount, destination: text, stepUpReference: text })),
  envelope("beginDispatch", text),
  envelope("recordSubmission", z.strictObject({ payoutId: text, outcome: z.enum(["unknown", "broadcast"]), transactionId: text.optional() })),
  envelope("confirmPayout", z.strictObject({ ...event, payoutId: text, providerReference: text })),
  envelope("reconcileAsset", z.strictObject({ assetId, observedRaw: raw, complete: z.boolean() })),
  envelope("setNativeFeeReadiness", z.strictObject({ assetId, ready: z.boolean() })),
  envelope("pause", z.null()),
]);

export type WalletCommand = z.infer<typeof walletCommandSchema>;
export type WalletCommandType = WalletCommand["type"];
export type CommandOf<T extends WalletCommandType> = Extract<WalletCommand, { type: T }>;
export type ResultOf<T extends WalletCommandType> = ReturnType<AlphaWalletSandbox[T]>;

export function parseWalletCommand(input: unknown): WalletCommand {
  const checked = walletCommandSchema.parse(input);
  // Persist exactly the shape evaluated, including removal of optional undefined fields.
  return walletCommandSchema.parse(JSON.parse(JSON.stringify(checked)));
}

/** Tagged, deterministic, one-way JSON encoding. It cannot revive executable objects. */
export function walletJson(value: unknown): unknown {
  if (typeof value === "bigint") return { $walletType: "bigint", value: value.toString() };
  if (value === undefined) return { $walletType: "undefined" };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Non-finite wallet value"); return value; }
  if (value instanceof Map) return { $walletType: "map", entries: [...value].map(([key, item]) => [walletJson(key), walletJson(item)]) };
  if (value instanceof Set) return { $walletType: "set", values: [...value].map(walletJson) };
  if (Array.isArray(value)) return value.map(walletJson);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Unsupported wallet value");
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, walletJson(item)]));
}
export function walletDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(walletJson(value))).digest("hex"); }
export function walletCommandKey(command: WalletCommand) { return JSON.stringify([command.actor.kind, command.actor.id, command.type, command.requestId]); }

export function applyWalletCommand(wallet: AlphaWalletSandbox, command: WalletCommand): unknown {
  const a = command.actor, r = command.requestId;
  switch (command.type) {
    case "createDepositIntent": return wallet.createDepositIntent(a, r, command.input);
    case "observeDeposit": return wallet.observeDeposit(a, r, command.input);
    case "createListing": return wallet.createListing(a, r, command.input);
    case "approveListing": return wallet.approveListing(a, r, command.input);
    case "closeListing": return wallet.closeListing(a, r, command.input);
    case "reserveTrade": return wallet.reserveTrade(a, r, command.input);
    case "markBuyerPaid": return wallet.markBuyerPaid(a, r, command.input);
    case "verifyPayment": return wallet.verifyPayment(a, r, command.input);
    case "authorizeRelease": return wallet.authorizeRelease(a, r, command.input);
    case "queueRelease": return wallet.queueRelease(a, r, command.input);
    case "cancelTrade": return wallet.cancelTrade(a, r, command.input);
    case "openDispute": return wallet.openDispute(a, r, command.input);
    case "requestWithdrawal": return wallet.requestWithdrawal(a, r, command.input);
    case "beginDispatch": return wallet.beginDispatch(a, r, command.input);
    case "recordSubmission": return wallet.recordSubmission(a, r, command.input);
    case "confirmPayout": return wallet.confirmPayout(a, r, command.input);
    case "reconcileAsset": return wallet.reconcileAsset(a, r, command.input);
    case "setNativeFeeReadiness": return wallet.setNativeFeeReadiness(a, r, command.input);
    case "pause": return wallet.pause(a, r);
  }
}
