/** CSV for owner spreadsheet downloads, not a lossless interchange format.
 * Quote every field; prefix formula-like text with a tab inside the quotes.
 * The prefix stays in the data (including on downstream imports).
 */
export function csvRow(values: readonly (string | number | null | undefined)[]): string {
  return values.map(value => {
    let text = String(value ?? "");
    if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+@\-＝＋－＠]/u.test(text)) text = `\t${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",");
}
