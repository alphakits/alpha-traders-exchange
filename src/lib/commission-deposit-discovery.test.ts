// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits, verifyBinanceInternalCommissionDeposit } from "./commission-deposit-discovery";
import { CANONICAL_TRC20_COMMISSION_WALLET as TRON, CANONICAL_BEP20_COMMISSION_WALLET as BSC, OFFICIAL_TRON_USDT_CONTRACT, BSC_USDT_CONTRACT } from "./commission-config";
const TX = "a".repeat(64);
const json = (body: unknown) => new Response(JSON.stringify(body));
const tron = (extra = {}) => ({ transaction_id: TX, from: "sender", to: TRON, type: "Transfer", value: "5000001", block_timestamp: Date.now(), token_info: { address: OFFICIAL_TRON_USDT_CONTRACT, decimals: 6 }, ...extra });
const bsc = (extra = {}) => ({ hash: `0x${TX}`, from: "sender", to: BSC, value: "5000001000000000000", timeStamp: String(Math.floor(Date.now() / 1000)), contractAddress: BSC_USDT_CONTRACT, tokenDecimal: "18", ...extra });
const internal = (extra = {}) => ({ id: "1234567890", txId: "410678442518", coin: "USDT", network: "TRX", address: TRON, amount: "5.00000100", status: 1, transferType: 1, insertTime: Date.now(), travelRuleStatus: 0, ...extra });
const enableBinance = () => { vi.stubEnv("ALPHA_EXCHANGE_BINANCE_READ_API_KEY", "read-key"); vi.stubEnv("ALPHA_EXCHANGE_BINANCE_READ_API_SECRET", "read-secret"); };
beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv("ALPHA_EXCHANGE_ETHERSCAN_API_KEY", "index-key"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("TRON deposit discovery", () => {
  it("reads subsequent pages and keeps credentials on the configured host", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_TRONGRID_API_KEY", "tron-key");
    const urls: URL[] = []; const signals: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = new URL(String(input)); urls.push(url); signals.push(init.signal);
      expect(init.headers["TRON-PRO-API-KEY"]).toBe("tron-key"); expect(init.redirect).toBe("error");
      return json(url.searchParams.has("fingerprint") ? { success: true, data: [tron()] }
        : { success: true, data: Array.from({ length: 200 }, () => tron({ value: "9999999" })), meta: { fingerprint: "next-page", links: { next: "https://evil.invalid" } } });
    }));
    const result = await scanTronCommissionDeposits(Date.now() - 60000);
    expect(result).toMatchObject({ complete: true, pages: 2 }); expect(result.deposits.some((d) => d.amountMicros === 5000001)).toBe(true);
    expect(urls[1].hostname).toBe("api.trongrid.io"); expect(urls[1].searchParams.get("fingerprint")).toBe("next-page"); expect(signals[0]).toBe(signals[1]);
  });
  it("rejects spoofed tokens, wrong recipients, malformed amounts and future timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: [tron({ token_info: { decimals: 6 } }), tron({ to: "wrong" }), tron({ value: "5.0" }), tron({ block_timestamp: Date.now() + 600000 }), tron({ type: "Approval" })] })));
    expect((await scanTronCommissionDeposits(Date.now() - 60000)).deposits).toEqual([]);
  });
  it("detects repeated provider cursors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: [], meta: { fingerprint: "loop" } })));
    await expect(scanTronCommissionDeposits(1)).rejects.toThrow("tron_repeated_cursor"); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
describe("BEP20 deposit discovery", () => {
  it("uses BSC and official USDT and preserves exact 18-decimal units", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input)); expect(url.searchParams.get("chainid")).toBe("56"); expect(url.searchParams.get("contractaddress")).toBe(BSC_USDT_CONTRACT);
      return json({ status: "1", result: [bsc(), bsc({ value: "5000001000000000001" }), bsc({ to: "0xwrong" }), bsc({ contractAddress: "0xfake" })] });
    }));
    const result = await scanBep20CommissionDeposits(Date.now() - 60000); expect(result.deposits).toHaveLength(1); expect(result.deposits[0].amountMicros).toBe(5000001);
  });
  it("distinguishes an unavailable API plan from an empty payment history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "0", result: "Paid plan required" })));
    await expect(scanBep20CommissionDeposits(1)).rejects.toThrow("bep20_index_plan_unsupported");
  });
  it.each([
    ["Free API access is not supported for this chain. Please upgrade your api plan", "bep20_index_plan_unsupported"],
    ["Invalid API Key", "bep20_index_key_invalid"],
    ["Max rate limit reached", "bep20_index_rate_limited"],
    ["Unexpected provider body with sensitive detail", "bep20_index_unavailable"],
  ])("classifies provider failures without reflecting response bodies: %s", async (message, label) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "0", result: message })));
    await expect(scanBep20CommissionDeposits(1)).rejects.toThrow(new RegExp(`^${label}$`));
  });
});
describe("Binance read-only internal deposit verification", () => {
  it("does not call Binance until both read-only credentials exist", async () => {
    vi.stubGlobal("fetch", vi.fn()); expect((await scanBinanceCommissionDeposits(1)).configured).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("signs only read-only deposit requests and accepts the exact credited destination", async () => {
    enableBinance(); vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = new URL(String(input)); const sig = url.searchParams.get("signature"); url.searchParams.delete("signature");
      expect(sig).toBe(createHmac("sha256", "read-secret").update(url.searchParams.toString()).digest("hex"));
      expect(url.origin + url.pathname).toBe("https://api.binance.com/sapi/v1/capital/deposit/hisrec"); expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
      expect(init.headers["X-MBX-APIKEY"]).toBe("read-key"); return json([internal()]);
    }));
    const result = await verifyBinanceInternalCommissionDeposit({ signature: "binance-deposit:1234567890", network: "TRC20", recipient: TRON, amount: 5.000001, earliestTimestamp: Date.now() - 60000 });
    expect(result.verified).toBe(true);
  });
  it("pages through Binance history with stable time bounds and a shared deadline", async () => {
    enableBinance();
    const requests: URL[] = [];
    const signals: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = new URL(String(input));
      requests.push(url); signals.push(init.signal);
      const offset = Number(url.searchParams.get("offset"));
      return json(offset === 0
        ? Array.from({ length: 200 }, (_, index) => internal({ id: String(index + 1) }))
        : [internal({ id: "201" })]);
    }));

    const scan = await scanBinanceCommissionDeposits(Date.now() - 60_000);

    expect(scan).toMatchObject({ configured: true, complete: true, pages: 2 });
    expect(scan.deposits).toHaveLength(201);
    expect(requests.map((url) => url.searchParams.get("offset"))).toEqual(["0", "200"]);
    expect(requests[1].searchParams.get("startTime")).toBe(requests[0].searchParams.get("startTime"));
    expect(requests[1].searchParams.get("endTime")).toBe(requests[0].searchParams.get("endTime"));
    expect(signals[1]).toBe(signals[0]);
  });
  it("walks older 89-day windows without gaps and resets the page offset", async () => {
    enableBinance();
    const windowMs = 89 * 24 * 60 * 60_000;
    const minTimestamp = Date.now() - 2 * windowMs - 2 * 24 * 60 * 60_000;
    const bounds: Array<{ start: number; end: number; offset: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      const start = Number(url.searchParams.get("startTime"));
      bounds.push({ start, end: Number(url.searchParams.get("endTime")), offset: url.searchParams.get("offset") });
      return json(start === minTimestamp ? [internal({ insertTime: minTimestamp })] : []);
    }));

    const scan = await scanBinanceCommissionDeposits(minTimestamp);

    expect(scan).toMatchObject({ configured: true, complete: true, pages: 3 });
    expect(scan.deposits).toEqual([expect.objectContaining({ timestamp: minTimestamp })]);
    expect(bounds.map((bound) => bound.offset)).toEqual(["0", "0", "0"]);
    expect(bounds[0].end - bounds[0].start).toBe(windowMs);
    expect(bounds[1].end).toBe(bounds[0].start - 1);
    expect(bounds[2].end).toBe(bounds[1].start - 1);
    expect(bounds[2].start).toBe(minTimestamp);
  });
  it("reports a full five-page response as incomplete rather than claiming the history is exhausted", async () => {
    enableBinance();
    const offsets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      offsets.push(offset);
      return json(Array.from({ length: 200 }, (_, index) => internal({ id: String(offset + index + 1) })));
    }));

    const scan = await scanBinanceCommissionDeposits(Date.now() - 60_000);

    expect(scan).toMatchObject({ configured: true, complete: false, pages: 5 });
    expect(scan.deposits).toHaveLength(1_000);
    expect(offsets).toEqual([0, 200, 400, 600, 800]);
  });
  it("shares the five-page budget across empty historical windows", async () => {
    enableBinance();
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal("fetch", fetchMock);

    const scan = await scanBinanceCommissionDeposits(Date.now() - 6 * 89 * 24 * 60 * 60_000);

    expect(scan).toEqual({ configured: true, complete: false, pages: 5, deposits: [] });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it.each([
    { status: 0 }, { status: 6 }, { address: "wrong" }, { coin: "USDC" }, { network: "ETH" }, { transferType: 0 },
    { travelRuleStatus: 1 }, { amount: "5.00000100001" }, { insertTime: 1 },
  ])("does not credit an invalid deposit: %j", async (extra) => {
    enableBinance(); vi.stubGlobal("fetch", vi.fn(async () => json([internal(extra)])));
    expect((await scanBinanceCommissionDeposits(Date.now() - 60000)).deposits).toEqual([]);
  });
  it.each([
    ["TRX", TRON, "TRC20", TX],
    ["BSC", BSC, "BEP20", `0x${TX}`],
  ])("discovers credited public %s deposits under their original chain reference", async (network, address, expectedNetwork, signature) => {
    enableBinance();
    vi.stubGlobal("fetch", vi.fn(async () => json([internal({ network, address, transferType: 0, txId: TX.toUpperCase() })])));
    const scan = await scanBinanceCommissionDeposits(Date.now() - 60000);
    expect(scan.deposits).toEqual([expect.objectContaining({ network: expectedNetwork, signature, amountMicros: 5000001 })]);
  });
  it("never verifies a public chain deposit through a second internal ID alias", async () => {
    enableBinance(); vi.stubGlobal("fetch", vi.fn(async () => json([internal({ txId: TX })])));
    const result = await verifyBinanceInternalCommissionDeposit({ signature: "binance-deposit:1234567890", network: "TRC20", recipient: TRON, amount: 5.000001, earliestTimestamp: Date.now() - 60000 });
    expect(result.verified).toBe(false);
    expect((await scanBinanceCommissionDeposits(Date.now() - 60000)).deposits[0].signature).toBe(TX);
  });
  it("fails closed on a forged ID, rounded amount or unavailable provider", async () => {
    enableBinance(); vi.stubGlobal("fetch", vi.fn(async () => json([internal()])));
    const input = { signature: "binance-deposit:1234567890", network: "TRC20", recipient: TRON, amount: 5, earliestTimestamp: Date.now() - 60000 };
    expect((await verifyBinanceInternalCommissionDeposit(input)).verified).toBe(false);
    expect((await verifyBinanceInternalCommissionDeposit({ ...input, signature: "binance-deposit:987654321" })).verified).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret provider detail"); }));
    const result = await verifyBinanceInternalCommissionDeposit(input); expect(result).toMatchObject({ verified: false, pending: true }); expect(result.notes).not.toContain("secret");
  });
});
