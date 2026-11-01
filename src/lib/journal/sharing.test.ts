import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptyReview, emptyTrade } from "./model";
import { resultsShare, rulesShare, selectedShare, shareText, tradeShare } from "./sharing";

const trade = { ...emptyTrade("2026-10-09"), id: "private-record-id", version: 42, symbol: "NQ", grossPnlCents: 15050, feesCents: 50, riskCents: 5000, notes: "PRIVATE NOTE", strategy: "PRIVATE SETUP", createdAt: "PRIVATE TIMESTAMP" };
const defaults = (doc: ReturnType<typeof tradeShare>) => selectedShare(doc, new Set(doc.fields.filter(field => field.selected).map(field => field.key)));
describe("explicit journal sharing boundaries", () => {
  it("shares the selected trade's allow-listed fields without notes, setup, risk, IDs or metadata by default", () => {
    const output = shareText(defaults(tradeShare(trade, "en")));
    expect(output).toContain("NQ"); expect(output).toContain("+$150.00");
    for (const secret of [trade.notes, trade.strategy, trade.id, trade.createdAt, "$50.00", "version"]) expect(output).not.toContain(secret);
  });
  it("only exports notes after explicitly selecting them and removes previously selected values", () => {
    const doc = tradeShare(trade, "ar");
    const notes = shareText(selectedShare(doc, new Set(["notes"])));
    expect(notes).toContain("PRIVATE NOTE"); expect(notes).not.toContain("NQ"); expect(notes).not.toContain("150.00");
    expect(shareText(selectedShare(doc, new Set()))).not.toContain("PRIVATE NOTE");
    expect(selectedShare(doc, new Set(["id", "version", "createdAt"])).fields).toEqual([]);
  });
  it("never represents an open trade as realized profit", () => {
    const doc = tradeShare({ ...trade, status: "open" }, "en");
    expect(doc.fields.some(field => field.key === "net")).toBe(false);
    expect(shareText(defaults(doc))).toContain("not realized");
  });
  it("aggregates only the supplied session and never includes individual trade details", () => {
    const doc = resultsShare([trade, { ...trade, status: "open", grossPnlCents: 999999 }], "2026-10-09", "en");
    const output = shareText(defaults(doc));
    expect(output).toContain("+$150.00"); expect(output).toContain("Closed trades: 1"); expect(output).toContain("100.0%");
    expect(output).not.toContain("NQ"); expect(output).not.toContain(trade.notes);
  });
  it("keeps review text and ratings off until specifically selected", () => {
    const doc = resultsShare([], "2026-10-09", "ar", { ...emptyReview("2026-10-09"), wentWell: "PRIVATE REVIEW", rating: 4 });
    expect(shareText(defaults(doc))).not.toContain("PRIVATE REVIEW");
    expect(shareText(selectedShare(doc, new Set(["wentWell"])))).toContain("PRIVATE REVIEW");
    expect(doc.fields.find(field => field.key === "rating")?.selected).toBe(false);
  });
  it("shares a selected plan without automatically disclosing risk thresholds or timezone", () => {
    const output = shareText(defaults(rulesShare({ ...DEFAULT_SETTINGS, rules: "Wait for confirmation" }, "en")));
    expect(output).toContain("Wait for confirmation"); expect(output).not.toContain("$300.00"); expect(output).not.toContain("Jerusalem");
  });
});
