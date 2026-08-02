import { describe, expect, it } from "vitest";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";

/**
 * EVM transaction hash format: 0x + 64 lowercase hex characters.
 * The normalizer must strip invisible Unicode characters injected by mobile
 * wallets, blockchain explorers, and clipboard managers before validation.
 */
const EVM_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

/** Real Polygon transaction used during commission payment QA. */
const REAL_POLYGON_TX = "0x0da1d53201fe2503aa221a74d44b8b7b59cdf427a2ce3f2332893475d0a0ccbc";

function isValidEvmHash(raw: string): boolean {
  return EVM_HASH_REGEX.test(normalizeTransactionHash(raw));
}

describe("normalizeTransactionHash", () => {
  // ── Clean input ────────────────────────────────────────────────────────────
  it("passes the real Polygon QA transaction hash unchanged", () => {
    expect(normalizeTransactionHash(REAL_POLYGON_TX)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(REAL_POLYGON_TX)).toBe(true);
  });

  it("passes a valid Ethereum hash", () => {
    const eth = "0x794bb03a07b613ee5c7a0ad91755da5d5b2c207935af153a8946e817dc43cfd4";
    expect(isValidEvmHash(eth)).toBe(true);
  });

  // ── Prefix normalization ───────────────────────────────────────────────────
  it("normalizes 0X prefix to 0x", () => {
    const upperPrefix = "0X" + REAL_POLYGON_TX.slice(2);
    expect(normalizeTransactionHash(upperPrefix)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(upperPrefix)).toBe(true);
  });

  // ── Invisible Unicode characters (survive String.trim()) ──────────────────
  it("strips zero-width space (U+200B) injected after 0x", () => {
    const withZWS = "0x\u200B" + REAL_POLYGON_TX.slice(2);
    expect(normalizeTransactionHash(withZWS)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(withZWS)).toBe(true);
  });

  it("strips narrow no-break space (U+202F) injected after 0x", () => {
    const withNNBS = "0x\u202F" + REAL_POLYGON_TX.slice(2);
    expect(normalizeTransactionHash(withNNBS)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(withNNBS)).toBe(true);
  });

  it("strips BOM (U+FEFF) prepended to hash", () => {
    const withBom = "\uFEFF" + REAL_POLYGON_TX;
    expect(normalizeTransactionHash(withBom)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(withBom)).toBe(true);
  });

  it("strips zero-width non-joiner (U+200C) embedded mid-hash", () => {
    const mid = REAL_POLYGON_TX.slice(0, 30) + "\u200C" + REAL_POLYGON_TX.slice(30);
    expect(normalizeTransactionHash(mid)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(mid)).toBe(true);
  });

  it("strips regular whitespace at ends", () => {
    const padded = "  " + REAL_POLYGON_TX + "\t\n";
    expect(normalizeTransactionHash(padded)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(padded)).toBe(true);
  });

  it("strips non-breaking space (U+00A0) prefix", () => {
    const withNBSP = "\u00A0" + REAL_POLYGON_TX;
    expect(normalizeTransactionHash(withNBSP)).toBe(REAL_POLYGON_TX);
    expect(isValidEvmHash(withNBSP)).toBe(true);
  });

  // ── Genuinely invalid hashes still fail ───────────────────────────────────
  it("rejects a hash that is too short (63 hex chars)", () => {
    expect(isValidEvmHash("0x" + "a".repeat(63))).toBe(false);
  });

  it("rejects a hash that is too long (65 hex chars)", () => {
    expect(isValidEvmHash("0x" + "a".repeat(65))).toBe(false);
  });

  it("rejects a hash with non-hex characters in body", () => {
    expect(isValidEvmHash("0x" + "g".repeat(64))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEvmHash("")).toBe(false);
  });

  it("rejects a Solana-style base58 hash for EVM validation", () => {
    const sol = "5UfgJ5vVZxGpiHKBpXGPb7fVQhJEeSRmZCG4FBsf8rHL";
    expect(isValidEvmHash(sol)).toBe(false);
  });
});
