// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWalletCommand, walletDigest, walletJson, WALLET_ENGINE_VERSION } from "./commands";

const valid = { version: 1, engineVersion: WALLET_ENGINE_VERSION, type: "createDepositIntent", actor: { kind: "seller", id: "seller-a" }, requestId: "request-a",
  input: { id: "deposit-a", assetId: "tron-sim-usdt", purpose: "principal" } };

describe("durable command boundary", () => {
  it("accepts only a versioned allowlisted command with no extra body fields", () => {
    expect(parseWalletCommand(valid)).toEqual(valid);
    for (const input of [
      { ...valid, version: 2 }, { ...valid, engineVersion: "future-engine" }, { ...valid, type: "eval" },
      { ...valid, actor: { ...valid.actor, admin: true } }, { ...valid, input: { ...valid.input, assetId: "mainnet-usdt" } },
      { ...valid, unsignedOverride: true }, { ...valid, requestId: "../request" },
    ]) expect(() => parseWalletCommand(input)).toThrow();
  });
  it("removes optional undefined before persistence and evaluation", () => {
    const result = parseWalletCommand({ ...valid, type: "recordSubmission", actor: { kind: "dispatcher", id: "worker" }, input: { payoutId: "trade-a", outcome: "unknown", transactionId: undefined } });
    if (result.type !== "recordSubmission") throw new Error("Wrong parsed command");
    expect(Object.hasOwn(result.input, "transactionId")).toBe(false);
  });
  it("preserves exact large integers and collection order in deterministic evidence", () => {
    const state = { units: BigInt(2) ** BigInt(200), map: new Map([["b", BigInt(9)], ["a", BigInt(1)]]), set: new Set(["z", "a"]), empty: undefined };
    expect(walletDigest(state)).toBe(walletDigest({ empty: undefined, set: state.set, map: state.map, units: state.units }));
    expect(walletDigest(state)).toBe(walletDigest(JSON.parse(JSON.stringify(walletJson(state)))));
    expect(walletDigest(state)).not.toBe(walletDigest({ ...state, map: new Map([["a", BigInt(1)], ["b", BigInt(9)]]) }));
    expect(walletDigest(BigInt(2) ** BigInt(200))).not.toBe(walletDigest((BigInt(2) ** BigInt(200)).toString()));
  });
  it("rejects executable/ambiguous non-JSON evidence types", () => {
    for (const value of [NaN, Infinity, () => undefined, new Date(), Symbol("value")]) expect(() => walletDigest(value)).toThrow();
  });
});
