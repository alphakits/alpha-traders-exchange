import { describe, expect, it } from "vitest";
import snapshot from "./weekly-calendar.json";
import { immediatelyFollows, officialSourceUrl, officialText, parseOfficialResult, type CalendarEvent, type OfficialDocument } from "./official-sources";

const hash = "a".repeat(64);
function event(key: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const item = snapshot.events.find(item => item.id.startsWith(`official-${key}-`));
  if (!item) throw new Error(key);
  return { ...item, actual: null, publishedAt: null, ...overrides } as CalendarEvent;
}
function document(text: string, html?: string): OfficialDocument { return { text, html, url: "https://www.bls.gov/news.release/cpi.nr0.htm", sha256: hash }; }
const now = Date.parse("2026-11-20T20:00:00Z");
const claims = "For release at 8:30 A.M. (Eastern) Thursday, October 22, 2026 UNEMPLOYMENT INSURANCE WEEKLY CLAIMS SEASONALLY ADJUSTED DATA In the week ending October 17, the advance figure for seasonally adjusted initial claims was 194,000. The previous week's level was revised up by 1,000 from 199,000 to 200,000.";
const cpi = "Transmission embargoed until 8:30 a.m. (ET) Wednesday, October 14, 2026 USDL-26-1234 CONSUMER PRICE INDEX - SEPTEMBER 2026 The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.6 percent on a seasonally adjusted basis in September. Over the last 12 months, the all items index increased 3.7 percent before seasonal adjustment. The index for all items less food and energy rose 0.3 percent in September.";
const ppi = "Transmission embargoed until 8:30 a.m. (ET) Thursday, October 15, 2026 PRODUCER PRICE INDEXES - SEPTEMBER 2026 The Producer Price Index for final demand increased 1.3 percent in September, seasonally adjusted.";
const durable = "For release at 8:30 AM EDT Tuesday, October 27, 2026 MONTHLY ADVANCE REPORT ON DURABLE GOODS MANUFACTURERS' SHIPMENTS, INVENTORIES AND ORDERS SEPTEMBER 2026 New orders for manufactured durable goods in September, up, increased $6.3 billion or 1.8 percent. This followed a 0.1 percent August increase. Excluding transportation, new orders increased 0.5 percent. Data are adjusted for seasonal variation.";
const retail = "For release at 8:30 AM EDT Thursday, October 15, 2026 ADVANCE MONTHLY SALES FOR RETAIL AND FOOD SERVICES, SEPTEMBER 2026 Table 1. Retail & food services, total 600 601 602 603 604 605 Table 2. Estimated Percent Change, adjusted for seasonal variations Retail & food services, total 0.8 6.3 1.3 5.6 1.2 5.5 Total (excl. motor vehicle & parts) 0.9 7.2 1.4 6.3 1.3 6.2 Table 3.";

describe("strict official publication parsing (recorded-format fixtures, no live network)", () => {
  it("confirms claims, original previous and revision for the exact week", () => {
    expect(parseOfficialResult(event("dol-initial-claims", { scheduledAt: "2026-10-22T12:30:00Z", reference: "Week ending 17 Oct 2026" }), document(claims), now)?.event)
      .toMatchObject({ actual: "194K", previous: "199K", revised: "200K", publishedAt: "2026-10-22T12:30:00Z" });
  });
  it("never assigns a newer current-release PDF to an earlier event", () => {
    expect(parseOfficialResult(event("dol-initial-claims"), document(claims), now)).toBeNull();
  });
  it("handles claims crossing a year boundary without accepting a different year", () => {
    const jan = claims.replace("Thursday, October 22, 2026", "Thursday, January 7, 2027").replace("October 17", "January 2");
    const e = event("dol-initial-claims", { scheduledAt: "2027-01-07T13:30:00Z", reference: "Week ending 2 Jan 2027" });
    expect(parseOfficialResult(e, document(jan), Date.parse("2027-01-07T14:00:00Z"))?.event.actual).toBe("194K");
    expect(parseOfficialResult({ ...e, reference: "Week ending 2 Jan 2026" }, document(jan), Date.parse("2027-01-07T14:00:00Z"))).toBeNull();
  });
  it.each([["bls-cpi-mom", "0.6%"], ["bls-core-cpi-mom", "0.3%"], ["bls-cpi-yoy", "3.7%"]])("keeps CPI series/adjustments distinct: %s", (key, actual) => {
    expect(parseOfficialResult(event(key), document(cpi), now)?.event.actual).toBe(actual);
  });
  it("preserves zero and negative readings", () => {
    expect(parseOfficialResult(event("bls-cpi-mom"), document(cpi.replace("increased 0.6", "decreased 0.2")), now)?.event.actual).toBe("-0.2%");
    expect(parseOfficialResult(event("bls-cpi-mom"), document(cpi.replace("increased 0.6", "increased 0.0")), now)?.event.actual).toBe("0%");
    expect(parseOfficialResult(event("bls-cpi-mom"), document(cpi.replace("increased 0.6 percent", "was unchanged")), now)?.event.actual).toBe("0%");
  });
  it("never uses a continuing-claims revision as the initial-claims previous value", () => {
    const text = claims.replace("The previous week's level was revised up by 1,000 from 199,000 to 200,000.", "The previous week's level was unrevised at 200,000. The 4-week moving average was 197,750. The previous week's level was revised down by 7,000 from 1,710,000 to 1,703,000.");
    expect(parseOfficialResult(event("dol-initial-claims", { scheduledAt: "2026-10-22T12:30:00Z", reference: "Week ending 17 Oct 2026" }), document(text), now)?.event.previous).toBe("200K");
  });
  it.each([
    cpi.replace("October 14, 2026", "November 10, 2026"),
    cpi.replace("SEPTEMBER 2026", "AUGUST 2026"),
    cpi.replace("8:30", "9:30"),
    cpi.replace("(ET)", "EST"),
    cpi.replace("seasonally adjusted", "not seasonally adjusted"),
  ])("rejects mismatched identity/time/units", text => expect(parseOfficialResult(event("bls-cpi-mom"), document(text), now)).toBeNull());
  it("does not infer publication from a passed time or parse future/tentative events", () => {
    const e = event("bls-cpi-mom");
    expect(parseOfficialResult(e, document("Schedule only"), now)).toBeNull();
    expect(parseOfficialResult(e, document(cpi), Date.parse(e.scheduledAt) - 1)).toBeNull();
    expect(parseOfficialResult({ ...e, timing: "tentative" }, document(cpi), now)).toBeNull();
  });
  it("distinguishes core PPI excluding food/energy from the trade-services exclusion", () => {
    const html = "<p>Seasonally adjusted 1-month percent change Aug. 2026 Sep. 2026 Final demand goods</p><table><tr>" + ["Final demand less foods and energy<span>(<a>5</a>)</span>", "FD", "49104", "89.487", "5.0", "0.0", "0.4", "0.3", "0.2", "0.7"].map(v => `<td>${v}</td>`).join("") + "</tr></table>";
    const e = event("bls-core-ppi-mom");
    expect(parseOfficialResult(e, document(ppi), now, document("", html))?.event).toMatchObject({ actual: "0.7%", revised: "0.2%" });
    expect(parseOfficialResult(e, document(ppi), now, document("", html.replace("49104", "49116")))).toBeNull();
    expect(parseOfficialResult(e, document(ppi), now, document("", html.replace("Seasonally adjusted", "Unadjusted")))).toBeNull();
    expect(parseOfficialResult(e, document(ppi), now, document("", html.replace("Sep. 2026 Final", "Sep. 2026 Oct. 2026 Final")))).toBeNull();
    expect(parseOfficialResult(event("bls-ppi-mom"), document(ppi), now)?.event.actual).toBe("1.3%");
  });
  it.each([["census-durable-goods-mom", "1.8%"], ["census-core-durable-goods-mom", "0.5%"]])("extracts durable goods %s despite decimals in dollar totals", (key, actual) => {
    expect(parseOfficialResult(event(key), document(durable), now)?.event.actual).toBe(actual);
  });
  it.each([["census-retail-sales-mom", "0.8%", "1.3%"], ["census-core-retail-sales-mom", "0.9%", "1.4%"]])("uses retail percentage table, not dollar totals: %s", (key, actual, revised) => {
    expect(parseOfficialResult(event(key), document(retail), now)?.event).toMatchObject({ actual, revised });
  });
  it("recognizes the Census PDF's adjusted Table 1 derivation footnote", () => {
    const text = retail.replace("Table 1.", "Data adjusted for seasonal variation. Table 1.")
      .replace("Estimated Percent Change, adjusted for seasonal variations", "Estimated Change in Monthly Sales")
      .replace("Table 3.", "Estimates shown in this table are derived from adjusted estimates provided in Table 1 of this report. Table 3.");
    expect(parseOfficialResult(event("census-retail-sales-mom"), document(text), now)?.event.actual).toBe("0.8%");
  });
  it("parses ECI's embargo identifier before its release clock", () => {
    const text = "Transmission embargoed until USDL-26-1270 8:30 a.m. (ET) Friday, October 30, 2026 EMPLOYMENT COST INDEX - SEPTEMBER 2026 Compensation costs for civilian workers increased 0.9 percent, seasonally adjusted, for the 3-month period ending in September 2026.";
    expect(parseOfficialResult(event("bls-employment-cost-index"), document(text), now)?.event.actual).toBe("0.9%");
  });
  it("distinguishes four PCE changes", () => {
    const text = "EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT Thursday, October 29, 2026 Personal Income and Outlays, September 2026 From the preceding month, the PCE price index for September increased 0.3 percent. Excluding food and energy, the PCE price index increased 0.2 percent. From the same month one year ago, the PCE price index for September increased 3.4 percent. Excluding food and energy, the PCE price index increased 3.0 percent from one year ago.";
    for (const [key, actual] of [["bea-pce-mom", "0.3%"], ["bea-core-pce-mom", "0.2%"], ["bea-pce-yoy", "3.4%"], ["bea-core-pce-yoy", "3%"]])
      expect(parseOfficialResult(event(key), document(text), now)?.event.actual).toBe(actual);
  });
  it("reads only the matching advance GDP quarter at annualized percent units", () => {
    const text = "EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT Thursday, October 29, 2026 Gross Domestic Product, Third Quarter 2026 (Advance Estimate) Real gross domestic product (GDP) increased at an annual rate of 2.1 percent in the third quarter of 2026.";
    expect(parseOfficialResult(event("bea-gdp-advance"), document(text), now)?.event.actual).toBe("2.1%");
    expect(parseOfficialResult(event("bea-gdp-advance"), document(text.replaceAll("third quarter", "second quarter")), now)).toBeNull();
  });
  it("reads payroll, unemployment, earnings and the immediately prior payroll revision separately", () => {
    const text = "Transmission embargoed until 8:30 a.m. (ET) Friday, November 6, 2026 THE EMPLOYMENT SITUATION - OCTOBER 2026 Total nonfarm payroll employment changed little in October (+29,000), and the unemployment rate was 4.2 percent. In October, average hourly earnings for all employees on private nonfarm payrolls edged up by 5 cents, or 0.1 percent. The change in total nonfarm payroll employment for September was revised down by 29,000, from +162,000 to +133,000.";
    expect(parseOfficialResult(event("bls-nfp"), document(text), now)?.event).toMatchObject({ actual: "29K", previous: "162K", revised: "133K" });
    expect(parseOfficialResult(event("bls-unemployment"), document(text), now)?.event.actual).toBe("4.2%");
    expect(parseOfficialResult(event("bls-hourly-earnings-mom"), document(text), now)?.event.actual).toBe("0.1%");
  });
  it("keeps the policy decision separate from minutes and unstructured speech summaries", () => {
    const text = "October 28, 2026 For release at 2:00 p.m. EDT The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent.";
    expect(parseOfficialResult(event("fed-fomc-decision"), document(text), now)?.event.actual).toBe("3.75%–4.00%");
    const minutes = "November 18, 2026 For release at 2:00 p.m. EST The Federal Reserve released the minutes of the meeting held October 27-28, 2026.";
    expect(parseOfficialResult(event("fed-fomc-minutes"), document(minutes), now)?.event.outcome?.en).toContain("not a new interest-rate decision");
    expect(parseOfficialResult(event("fed-fomc-minutes", { outcome: { en: "Verified editorial history.", ar: "ملخص موثّق." } }), document(minutes), now)).toBeNull();
    expect(officialSourceUrl(event("fed-fomc-press-conference"))).toBeNull();
  });
  it("normalizes HTML without script/nav content", () => expect(officialText("<nav>fake</nav><script>bad</script><p>A&nbsp;&amp; B&#37;</p>")).toBe("A & B%"));
  it("only carries comparisons to the immediately preceding period of the same series", () => {
    const a = event("bls-cpi-mom");
    expect(immediatelyFollows(a, { ...a, reference: "October 2026" })).toBe(true);
    expect(immediatelyFollows(a, { ...a, reference: "November 2026" })).toBe(false);
    expect(immediatelyFollows(a, event("bls-core-cpi-mom", { reference: "October 2026" }))).toBe(false);
    const q = event("bls-employment-cost-index");
    expect(immediatelyFollows(q, { ...q, reference: "Q4 2026" })).toBe(true);
  });
});
