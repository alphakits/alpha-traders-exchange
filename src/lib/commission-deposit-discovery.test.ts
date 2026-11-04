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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
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
  it("resumes after page five against the same frozen upper block", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input)); requests.push(url);
      if (url.searchParams.get("action") === "getblocknobytime") return json({ status: "1", result: "200000" });
      expect(url.searchParams.get("endblock")).toBe("200000");
      return json({ status: "1", result: Number(url.searchParams.get("page")) <= 5 ? Array.from({ length: 200 }, () => bsc()) : [bsc()] });
    }));
    const since = Date.now() - 60000;
    const first = await scanBep20CommissionDeposits(since, { until: Date.now() });
    expect(first).toMatchObject({ complete: false, pages: 5, continuation: { page: 6, endBlock: "200000" } });
    expect(await scanBep20CommissionDeposits(since, first.continuation)).toMatchObject({ complete: true, pages: 1 });
    expect(requests.filter(url => url.searchParams.get("action") === "getblocknobytime")).toHaveLength(1);
    expect(requests.at(-1)!.searchParams.get("page")).toBe("6");
  });
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
  describe.each(["block lookup", "transfer lookup"])("%s diagnostics", (stage) => {
    const progress = () => stage === "block lookup" ? { until: Date.now() } : undefined;
    const fallback = stage === "block lookup" ? "bep20_index_block_unavailable" : "bep20_index_unavailable";
    it.each([
      ["Free API access is not supported for this chain. Please upgrade your api plan", "bep20_index_plan_unsupported"],
      ["Invalid API Key", "bep20_index_key_invalid"],
      ["Max rate limit reached", "bep20_index_rate_limited"],
      ["Community Free API limit reached. Resets 2026-10-20 12:00:00 UTC. Please upgrade your api plan", "bep20_index_quota_exhausted"],
      ["Query Timeout occured. Please select a smaller result dataset", "bep20_index_query_timeout"],
      ["Unexpected provider body", undefined],
    ])("keeps a safe failure reason without publishing credentials: %s", async (message, label) => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ status: "0", result: `${message}; apikey=index-key; private detail` })));
      await expect(scanBep20CommissionDeposits(1, progress())).rejects.toThrow(new RegExp(`^${label ?? fallback}$`));
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it.each([null, [], { status: "0", result: { secret: "index-key" } }, { status: "1", result: "invalid-block" }])(
      "rejects malformed provider responses with the safe stage-specific reason: %j", async (payload) => {
        vi.stubGlobal("fetch", vi.fn(async () => json(payload)));
        await expect(scanBep20CommissionDeposits(1, progress())).rejects.toThrow(new RegExp(`^${fallback}$`));
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );
  });
});
describe("Binance read-only internal deposit verification", () => {
  it("resumes a fixed Binance window after 1,000 observations", async () => {
    enableBinance(); const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input)); requests.push(url);
      const offset = Number(url.searchParams.get("offset"));
      return json(offset < 1000 ? Array.from({ length: 200 }, (_, index) => internal({ id: String(offset + index + 1) })) : [internal({ id: "1001" })]);
    }));
    const since = Date.now() - 60000;
    const until = Date.now();
    const first = await scanBinanceCommissionDeposits(since, { until });
    expect(first).toMatchObject({ complete: false, continuation: { offset: 1000, windowEnd: until, until } });
    const next = await scanBinanceCommissionDeposits(since, first.continuation);
    expect(next).toMatchObject({ complete: true, pages: 1 });
    expect(next.deposits[0].signature).toBe("binance-deposit:1001");
    expect(requests.every(url => url.searchParams.get("endTime") === String(until))).toBe(true);
  });
  it("uses an observed time only as a search hint and revalidates the receiving account", async () => {
    enableBinance(); const timestamp = Date.now() - 60000;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("startTime")).toBe(String(timestamp - 1));
      expect(url.searchParams.get("endTime")).toBe(String(timestamp + 1));
      return json([internal({ insertTime: timestamp, amount: "4.000001" })]);
    }));
    const result = await verifyBinanceInternalCommissionDeposit({ signature: "binance-deposit:1234567890", network: "TRC20", recipient: TRON,
      amount: 5.000001, earliestTimestamp: timestamp - 100000, depositTimestamp: timestamp });
    expect(result.verified).toBe(false);
  });
  it("does not call Binance until both read-only credentials exist", async () => {
    vi.stubGlobal("fetch", vi.fn()); expect((await scanBinanceCommissionDeposits(1)).configured).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("signs only read-only deposit requests and accepts the exact credited destination", async () => {
    enableBinance(); vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = new URL(String(input)); const sig = url.searchParams.get("signature"); url.searchParams.delete("signature");
      expect(sig).toBe(createHmac("sha256", "read-secret").update(url.searchParams.toString()).digest("hex"));
      expect(url.searchParams.has("status")).toBe(false);
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
    expect(scan.diagnostics).toMatchObject({ observedRows: 201, acceptedRows: 201, rejectedRows: 0, rejectedReasons: {} });
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

    expect(scan).toMatchObject({ configured: true, complete: false, pages: 5, deposits: [],
      diagnostics: { observedRows: 0, acceptedRows: 0, rejectedRows: 0, latestObservedTimestamp: null, latestAcceptedTimestamp: null } });
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
  describe("bounded receiving-history diagnostics", () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T17:53:00.000Z")); enableBinance(); });
    it("distinguishes an empty response from nonempty history containing only non-successful deposits", async () => {
      const timestamp = Date.now() - 25_000;
      vi.stubGlobal("fetch", vi.fn(async (input) => {
        expect(new URL(String(input)).searchParams.has("status")).toBe(false);
        return json([internal({ status: 0, insertTime: timestamp }), internal({ status: 6, insertTime: timestamp }), internal({ status: 8, insertTime: timestamp })]);
      }));
      const withheld = await scanBinanceCommissionDeposits(Date.now() - 60_000);
      expect(withheld).toMatchObject({ complete: true, deposits: [], diagnostics: {
        observedRows: 3, acceptedRows: 0, rejectedRows: 3, recentObservedRows: 3, recentAcceptedRows: 0, recentRejectedRows: 3,
        rejectedReasons: { status_pending: 1, status_credited_locked: 1, status_waiting_confirmation: 1 },
        recentRejectedReasons: { status_pending: 1, status_credited_locked: 1, status_waiting_confirmation: 1 },
        latestObservedTimestamp: timestamp, latestAcceptedTimestamp: null,
        latestRejectedAtByReason: { status_pending: timestamp, status_credited_locked: timestamp, status_waiting_confirmation: timestamp },
      } });
      vi.stubGlobal("fetch", vi.fn(async () => json([])));
      expect(await scanBinanceCommissionDeposits(Date.now() - 60_000)).toMatchObject({ complete: true, deposits: [], diagnostics: {
        observedRows: 0, acceptedRows: 0, rejectedRows: 0, rejectedReasons: {}, recentRejectedReasons: {},
        latestObservedTimestamp: null, latestAcceptedTimestamp: null, latestRejectedAtByReason: {},
      } });
    });
    it.each([
      [{ status: 2 }, "status_rejected"], [{ status: 7 }, "status_wrong_deposit"], [{ status: "1" }, "invalid_status"],
      [{ coin: "USDC" }, "asset_mismatch"], [{ network: "ETH" }, "unsupported_network"],
      [{ address: "wrong" }, "destination_mismatch"], [{ transferType: 2 }, "unsupported_transfer_type"],
      [{ transferType: "1" }, "unsupported_transfer_type"], [{ travelRuleStatus: 1 }, "travel_rule_not_cleared"],
      [{ travelRuleStatus: "0" }, "travel_rule_not_cleared"], [{ amount: "5.00000100001" }, "invalid_amount"],
      [{ amount: 5.000001 }, "invalid_amount"], [{ amount: "0" }, "invalid_amount"],
      [{ id: "not-a-deposit-id" }, "invalid_reference"], [{ id: 1234567890 }, "invalid_reference"],
      [{ txId: `${TX}:0`, transferType: 0 }, "invalid_reference"],
      [{ insertTime: "not-a-time" }, "invalid_timestamp"], [{ insertTime: 1 }, "before_scan_window"],
    ])("reports only a fixed rejection reason without widening acceptance: %j", async (extra, reason) => {
      vi.stubGlobal("fetch", vi.fn(async () => json([internal(extra)])));
      expect(await scanBinanceCommissionDeposits(Date.now() - 60_000)).toMatchObject({ complete: true, deposits: [], diagnostics: {
        observedRows: 1, acceptedRows: 0, rejectedRows: 1, rejectedReasons: { [String(reason)]: 1 },
      } });
    });
    it.each([0, 6, 8])("does not verify a receipt with observed status %s", async (status) => {
      vi.stubGlobal("fetch", vi.fn(async () => json([internal({ status })])));
      expect(await verifyBinanceInternalCommissionDeposit({ signature: "binance-deposit:1234567890", network: "TRC20", recipient: TRON,
        amount: 5.000001, earliestTimestamp: Date.now() - 60_000 })).toMatchObject({ verified: false, pending: true });
    });
    it("preserves valid internal and public receipt identities while counting rejected observations across pages", async () => {
      const timestamp = Date.now() - 30_000;
      const newerTimestamp = timestamp + 1_000;
      vi.stubGlobal("fetch", vi.fn(async (input) => {
        const offset = Number(new URL(String(input)).searchParams.get("offset"));
        return json(offset === 0 ? Array.from({ length: 200 }, () => internal({ network: "ETH", insertTime: timestamp }))
          : [internal({ insertTime: timestamp }), internal({ network: "BSC", address: BSC.toUpperCase(), txId: TX.toUpperCase(), transferType: 0, insertTime: newerTimestamp })]);
      }));
      const scan = await scanBinanceCommissionDeposits(Date.now() - 60_000);
      expect(scan).toMatchObject({ complete: true, pages: 2, diagnostics: {
        observedRows: 202, acceptedRows: 2, rejectedRows: 200, recentObservedRows: 202, recentAcceptedRows: 2, recentRejectedRows: 200,
        rejectedReasons: { unsupported_network: 200 }, recentRejectedReasons: { unsupported_network: 200 },
        latestObservedTimestamp: newerTimestamp, latestAcceptedTimestamp: newerTimestamp,
        latestRejectedAtByReason: { unsupported_network: timestamp },
      } });
      expect(scan.deposits).toEqual([
        { network: "TRC20", signature: "binance-deposit:1234567890", payer: "", amountMicros: 5_000_001, timestamp },
        { network: "BEP20", signature: `0x${TX}`, payer: "", amountMicros: 5_000_001, timestamp: newerTimestamp },
      ]);
    });
    it("retains rejected-row paging and incomplete-history bounds", async () => {
      vi.stubGlobal("fetch", vi.fn(async (input) => {
        const offset = Number(new URL(String(input)).searchParams.get("offset"));
        return json(offset < 1_000 ? Array.from({ length: 200 }, () => internal({ status: 6 })) : [internal()]);
      }));
      const since = Date.now() - 60_000;
      const first = await scanBinanceCommissionDeposits(since, { until: Date.now() });
      expect(first).toMatchObject({ complete: false, pages: 5, deposits: [], continuation: { offset: 1_000 }, diagnostics: {
        observedRows: 1_000, acceptedRows: 0, rejectedRows: 1_000, rejectedReasons: { status_credited_locked: 1_000 },
      } });
      const next = await scanBinanceCommissionDeposits(since, first.continuation);
      expect(next).toMatchObject({ complete: true, pages: 1, diagnostics: { observedRows: 1, acceptedRows: 1, rejectedRows: 0 } });
      expect(next.deposits).toHaveLength(1);
    });
    it("counts recent rows against scan-start time and retains valid older rejection times", async () => {
      const now = Date.now();
      const recentBoundary = now - 15 * 60_000;
      const older = recentBoundary - 1;
      vi.stubGlobal("fetch", vi.fn(async () => json([
        internal({ network: "ETH", insertTime: recentBoundary }), internal({ network: "ETH", insertTime: older }),
        internal({ status: 6, insertTime: older - 1 }), internal({ address: "wrong", insertTime: now + 1 }),
        internal({ insertTime: now + 10 * 60_000 }), internal({ insertTime: "invalid" }),
        internal({ insertTime: now - 2 * 60_000, completeTime: now }),
      ])));
      const scan = await scanBinanceCommissionDeposits(now - 60_000);
      expect(scan).toMatchObject({ complete: true, deposits: [], diagnostics: {
        observedRows: 7, acceptedRows: 0, rejectedRows: 7, observedAt: now, recentWindowMs: 900_000,
        recentObservedRows: 2, recentRejectedRows: 2, recentRejectedReasons: { unsupported_network: 1, before_scan_window: 1 },
        latestObservedTimestamp: now + 1, latestAcceptedTimestamp: null,
        latestRejectedAtByReason: { unsupported_network: recentBoundary, status_credited_locked: older - 1,
          destination_mismatch: now + 1, before_scan_window: now - 2 * 60_000 },
      } });
      expect(scan.diagnostics!.latestRejectedAtByReason).not.toHaveProperty("invalid_timestamp");
      vi.stubGlobal("fetch", vi.fn(async () => json([internal({ network: "ETH", insertTime: now - 61 * 60_000 })])));
      expect(await scanBinanceCommissionDeposits(now - 2 * 60 * 60_000, { until: now - 60 * 60_000 })).toMatchObject({ diagnostics: {
        observedRows: 1, recentObservedRows: 0, recentRejectedReasons: {}, latestRejectedAtByReason: { unsupported_network: now - 61 * 60_000 },
      } });
    });
    it("does not put raw account records, arbitrary provider text, credentials or signed requests into diagnostics", async () => {
      const privateValues = ["raw-provider-private-value", "private-account-address", "private-transaction-reference", "777.123456", "private-status", "read-key", "read-secret"];
      vi.stubGlobal("fetch", vi.fn(async () => json([
        internal({ amount: "777.123456", privateField: privateValues[0] }),
        internal({ address: privateValues[1], txId: privateValues[2], amount: "777.123456" }),
        internal({ status: privateValues[4], network: privateValues[0] }), null, "raw-provider-private-value", [],
      ])));
      const scan = await scanBinanceCommissionDeposits(Date.now() - 60_000);
      expect(scan.deposits).toHaveLength(1);
      expect(scan.diagnostics).toMatchObject({ observedRows: 6, acceptedRows: 1, rejectedRows: 5,
        rejectedReasons: { destination_mismatch: 1, invalid_status: 1, malformed_record: 3 } });
      const serialized = JSON.stringify(scan.diagnostics);
      for (const value of [...privateValues, TRON, TX, "1234567890", "https://", "signature=", "X-MBX-APIKEY"]) expect(serialized).not.toContain(value);
      expect(Object.values(scan.diagnostics!.rejectedReasons).every(value => Number.isSafeInteger(value))).toBe(true);
    });
  });
});
