// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeDevelopmentPaymentDisputeReason } from "./payment-marketplace-canonical";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE SCHEMA alpha_wallet_payment_marketplace_simulation");
  await db.exec(await readFile(join(process.cwd(), "docs/alpha-wallet/payment-marketplace-reason.sql"), "utf8"));
}, 30_000);
afterAll(async () => { await db.close(); });

function acceptedByCurrentPlanner(reason: string | null): boolean {
  try { return normalizeDevelopmentPaymentDisputeReason(reason as string) === reason; }
  catch { return false; }
}
async function acceptedByDatabase(reason: string | null): Promise<boolean> {
  const result = await db.query<{ valid: boolean }>(
    "SELECT alpha_wallet_payment_marketplace_simulation.valid_dispute_reason($1::text) AS valid", [reason]);
  return result.rows[0].valid;
}

const examples: Array<[string, string | null]> = [
  ["null", null], ["empty", ""], ["ordinary bank assertion", "The seller has not confirmed my bank transfer."],
  ["ordinary Unicode assertion", "התשלום עדיין לא אושר — plata nu a fost confirmată."],
  ["500 ASCII units", "a".repeat(500)], ["501 ASCII units", "a".repeat(501)],
  ["500 UTF-16 emoji units", "😀".repeat(250)], ["502 UTF-16 emoji units", "😀".repeat(251)],
  ["mixed 500 units", "a".repeat(498) + "😀"], ["mixed 501 units", "a".repeat(499) + "😀"],
  ["Israeli phone", "Please call 052-123-4567."], ["Israeli landline", "Call 02 123 4567."],
  ["international phone", "Use +44 20 1234 5678."], ["international 00 phone", "Use 0044 20 1234 5678."],
  ["generic dashed phone", "Call 555-123-4567."], ["generic parenthesized phone", "Call (555) 123 4567."],
  ["ordinary contiguous bank reference", "Bank reference 1234567890123456 is still pending."],
  ["phone embedded in a word", "Reference A0521234567Z has not arrived."],
  ["email", "Please contact buyer@example.com."], ["spaced email", "Use buyer @ example . com."],
  ["obfuscated email", "Use buyer [at] example [dot] com."], ["parenthesized email", "Use buyer (at) example (dot) com."],
  ["email with nonword local part", "+@a.co"], ["email beside a Unicode letter", "אbuyer@a.co"],
  ["WhatsApp URL", "Use https://wa.me/123."], ["WhatsApp API URL", "Use api.whatsapp.com/send?phone=123."],
  ["WhatsApp chat URL", "Use chat.whatsapp.com/abcdef."], ["Telegram URL", "Use t.me/example."],
  ["bare Telegram URL", "See telegram.dog/"], ["Signal URL", "Use signal.me/example."],
  ["Messenger URL", "Use m.me/example."], ["Discord URL", "Use discordapp.com/invite/example."],
  ["social URL", "Use Instagram.com/example."], ["mailto", "Use mailto:a@b.co."],
  ["tel scheme", "Use tel:123."], ["SMS scheme", "Use sms:123."], ["Skype scheme", "Use skype:example."],
  ["Telegram label", "Telegram username: example"], ["spaced Telegram label", "Tele gram - @example"],
  ["bare handle", "Use @example."], ["short bare handle", "Use @tiny."],
  ["long bare handle", "Use @" + "a".repeat(33) + "."], ["handle beside a Unicode letter", "א@example"],
  ["word-attached handle", "A@example"], ["double at-sign", "@@example"],
  ["contact phrase", "Contact me via Signal."], ["contact phrase uppercase", "WRITE US ON WHATS APP."],
  ["noncontact platform mention", "The application status is still pending."],
  ["dotless i remains distinct", "Contact me via Sıgnal."], ["dotless i scheme remains distinct", "Use maılto:a."],
  ["fullwidth NFKC email", "ｂｕｙｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ"],
  ["compatibility NFKC phrase", "Contact me via ſignal."],
  ["fullwidth NFKC phrase", "Ｃｏｎｔａｃｔ ｍｅ ｖｉａ Ｓｉｇｎａｌ."],
  ["NFKC circled digit phone", "Call ⓪⑤②-①②③-④⑤⑥⑦."],
  ["ordinary hash", "Hash deadbeef0123456789abcdef remains unconfirmed."],
  ["embedded non-whitespace NEL", "\u0085Pending transfer\u0085"],
  ["embedded non-whitespace Mongolian separator", "\u180ePending transfer\u180e"],
  ["embedded non-whitespace zero-width space", "\u200bPending transfer\u200b"],
];
const whitespaceCodePoints = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];

describe("payment SQL reason validation matches the existing JavaScript policy", () => {
  it.each(examples)("%s", async (_name, reason) => {
    expect(await acceptedByDatabase(reason)).toBe(acceptedByCurrentPlanner(reason));
  });
  it.each(whitespaceCodePoints)("preserves ECMAScript whitespace U+%s semantics", async codePoint => {
    const space = String.fromCodePoint(codePoint);
    for (const reason of [space + "Pending transfer", "Pending transfer" + space,
      "Pending" + space + "transfer", "Contact" + space + "me" + space + "via" + space + "Signal"]) {
      expect(await acceptedByDatabase(reason)).toBe(acceptedByCurrentPlanner(reason));
    }
    const normalized = normalizeDevelopmentPaymentDisputeReason(space + "Pending transfer" + space);
    expect(await acceptedByDatabase(normalized)).toBe(true);
  });
  it("rejects the concrete stored-reason gaps independently of coordinator normalization", async () => {
    for (const reason of ["\tPending transfer", "Pending transfer\u00a0", "😀".repeat(251), "Contact me via Signal."]) {
      expect(await acceptedByDatabase(reason)).toBe(false);
    }
    expect(await acceptedByDatabase("😀".repeat(250))).toBe(true);
    expect(await acceptedByDatabase("Contact me via Sıgnal.")).toBe(true);
    expect(await acceptedByDatabase("+@a.co")).toBe(true);
  });
});
