import { describe, expect, it } from "vitest";
import { csvRow } from "./csv";

describe("owner spreadsheet CSV", () => {
  it("contains commas, quotes and line breaks within their original cells", () => {
    expect(csvRow(['Synthetic, Buyer', 'He said "yes"', 'first\nsecond', 'اسم، عربي'])).toBe('"Synthetic, Buyer","He said ""yes""","first\nsecond","اسم، عربي"');
  });
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(1)', '\t=1', '\r\n=1', '  =1', '\u0000=1', '＝1', '＋1', '－1', '＠SUM(1)'])("neutralizes spreadsheet-leading text %j", value => {
    expect(csvRow([value])).toBe(`"\t${value}"`);
  });
  it("keeps numeric amounts and ordinary text unchanged", () => {
    expect(csvRow([389.547151, -2, 0, '2026-10-18', 'TR-000188', null, undefined])).toBe('"389.547151","-2","0","2026-10-18","TR-000188","",""');
  });
  it("quotes separator injection so a formula cannot start another cell", () => {
    expect(csvRow(['Synthetic",=1+1', 'safe'])).toBe('"Synthetic"",=1+1","safe"');
  });
});
