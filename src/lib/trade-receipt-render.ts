import { formatMoneyNumber, receiptDate, receiptEventLabel, receiptNotice, tradeReceiptDisplayRows, type TradeCompletionReceipt } from "@alpha-traders/contracts";
import { moneyColors } from "@alpha-traders/design-tokens";
import { BRAND_EMAIL_LOGO_SRC, BRAND_NAME, BRAND_NAME_HTML } from "@/lib/brand";
import { emailDisplayHtml, escapeHtml as escape } from "@/lib/email-display-text";

/** Receipt email uses inline styles and solid color fallbacks for mail clients.
 * All financial values come from the exact snapshot used by the print attachment. */
export function brandedTradeReceiptEmail(receipt: TradeCompletionReceipt, locale: "ar" | "en", tradeUrl: string) {
  const ar = locale === "ar";
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const direction = ar ? "rtl" : "ltr";
  const start = ar ? "right" : "left";
  const end = ar ? "left" : "right";
  const title = t("Trade completed", "اكتملت الصفقة");
  const ref = escape(receipt.tradeReference);
  const intro = t("Your receipt is saved. You can find the same figures and the full trade history in your account.", "تم حفظ إيصالك. يمكنك الرجوع إلى الأرقام نفسها وإلى سجل الصفقة الكامل من حسابك.");
  const action = t("View receipt and trade history", "عرض الإيصال وسجل الصفقة");
  const attached = t("A printable copy is attached to this email.", "ستجد نسخة قابلة للطباعة مرفقة بهذه الرسالة.");
  const detailRows = tradeReceiptDisplayRows(receipt, locale).map(([label, value, isMoney]) => `<tr><th scope="row" align="${start}" style="width:51%;padding:10px 4px;border-bottom:1px solid #303032;font-weight:400;color:${isMoney ? moneyColors.onDark : "#c7c6c3"};line-height:1.5">${isMoney ? escape(label) : emailDisplayHtml(label)}</th><td align="${end}" style="padding:10px 4px;border-bottom:1px solid #303032;color:${isMoney ? moneyColors.onDark : "#f3f0e8"};font-weight:600;line-height:1.5;overflow-wrap:anywhere"><span dir="auto">${escape(isMoney ? formatMoneyNumber(value) : value)}</span></td></tr>`).join("");
  const history = receipt.history.map(entry => `<tr><td style="padding:7px 0;color:#edeae5;font-size:14px;line-height:1.5"><span style="color:#dcbe82">•</span> &nbsp;${emailDisplayHtml(receiptEventLabel(entry.event, locale))}<br><span style="font-size:12px;color:#b0b0b0">${escape(receiptDate(entry.at, locale))}</span></td></tr>`).join("");
  return {
    subject: `${title} · ${receipt.tradeReference} | ${BRAND_NAME}`,
    text: [title, intro, `${action}: ${tradeUrl}`, attached, renderTradeReceipt(receipt, locale).text].join("\n\n"),
    html: `<!doctype html><html lang="${locale}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head>
<body bgcolor="#0b0b0c" style="margin:0;background-color:#0b0b0c;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0b0b0c" style="background-color:#0b0b0c"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" dir="${direction}" width="100%" cellspacing="0" cellpadding="0" bgcolor="#141415" style="max-width:560px;text-align:${start};background-color:#141415;border:1px solid #343230;border-top:3px solid #c79e54;border-radius:14px;overflow:hidden">
<tr><td bgcolor="#101011" style="padding:16px 20px;background-color:#101011;border-bottom:1px solid #34312b"><table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td width="65"><img src="${BRAND_EMAIL_LOGO_SRC}" width="54" height="54" alt="${BRAND_NAME_HTML}" style="display:block;width:54px;height:54px;border:0;border-radius:50%"></td>
<td style="vertical-align:middle"><strong dir="ltr" style="display:block;color:#faf6ee;font-size:17px;line-height:1.4;letter-spacing:1.2px">ALPHA TRADERS</strong><span style="display:block;color:#dabe85;font-size:12px;line-height:1.4">${t("Academy &amp; Exchange", "الأكاديمية والسوق")}</span></td></tr></table></td></tr>
<tr><td bgcolor="#22201b" style="padding:24px 20px;background-color:#22201b;background-image:linear-gradient(115deg,#2d291e,#1d1c1c);border-bottom:1px solid #4a4030">
<p style="margin:0 0 9px;color:#e9c784;font-size:11px;font-weight:700;letter-spacing:${ar ? "0" : "1.5px"}">${t("PRIVATE TRADE RECEIPT", "إيصال صفقة خاص")} &nbsp;·&nbsp; <span dir="ltr">${ref}</span></p>
<h1 style="margin:0;color:#fffaf0;font-size:32px;line-height:1.22">${title}</h1><p style="margin:10px 0 0;color:#dbd7cf;font-size:15px;line-height:1.6">${intro}</p></td></tr>
<tr><td style="padding:20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr>
<td width="50%" style="vertical-align:top;padding:0 4px"><span style="font-size:12px;color:${moneyColors.onDark}">${t("USDT traded", "كمية USDT المتداولة")}</span><br><strong dir="ltr" style="display:inline-block;margin-top:5px;color:${moneyColors.onDark};font-size:21px;line-height:1.3;overflow-wrap:anywhere">${escape(formatMoneyNumber(receipt.usdtAmount))} <small style="font-size:12px">USDT</small></strong></td>
<td width="50%" style="vertical-align:top;padding:0 7px;border-${start}:1px solid #423e35"><span style="font-size:12px;color:${moneyColors.onDark}">${t("Payment total", "إجمالي الدفع")}</span><br><strong dir="ltr" style="display:inline-block;margin-top:5px;color:${moneyColors.onDark};font-size:21px;line-height:1.3;overflow-wrap:anywhere">${escape(formatMoneyNumber(receipt.fiatAmount))} <small style="font-size:12px">${escape(receipt.currency)}</small></strong></td>
</tr></table><p style="margin:20px 0 0"><a href="${escape(tradeUrl)}" style="display:inline-block;max-width:100%;box-sizing:border-box;padding:13px 18px;background-color:#e2bd77;color:#17130c;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;line-height:1.4">${action}</a></p><p style="margin:9px 0 0;font-size:12px;line-height:1.6;color:#bbb8b2">${attached}</p></td></tr>
<tr><td style="padding:0 20px 16px"><h2 style="margin:7px 0 4px;font-size:20px;color:#f7f3eb">${t("Receipt details", "تفاصيل الإيصال")}</h2><table width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px">${detailRows}</table>
<p style="margin:12px 0 0;color:#b6b3ae;font-size:12px;line-height:1.65">${emailDisplayHtml(receiptNotice(receipt, locale))}</p></td></tr>
<tr><td style="padding:4px 20px 20px"><h2 style="margin:6px 0;font-size:20px;color:#f7f3eb">${t("History at completion", "سجل الصفقة عند الإتمام")}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${history}</table></td></tr>
<tr><td bgcolor="#101011" style="padding:16px 20px;color:#b7b4ae;background-color:#101011;border-top:1px solid #343230;font-size:12px;line-height:1.6">${t("Keep this receipt for your records. Chat, evidence and protected payment details are not included in this email.", "احتفظ بهذه النسخة لسجلاتك. لا تحتوي هذه الرسالة على المحادثة أو الإثباتات أو بيانات الدفع المحمية.")}</td></tr>
</table></td></tr></table></body></html>`,
  };
}

export function renderTradeReceipt(receipt: TradeCompletionReceipt, locale: "ar" | "en") {
  const heading = locale === "ar" ? "إيصال الصفقة" : "Trade receipt";
  const rows = tradeReceiptDisplayRows(receipt, locale);
  const history = receipt.history.map(entry => ({ date: receiptDate(entry.at, locale), event: receiptEventLabel(entry.event, locale) }));
  const notice = receiptNotice(receipt, locale);
  return {
    text: [heading, ...rows.map(([label, value, isMoney]) => `${label}: ${isMoney ? formatMoneyNumber(value) : value}`), notice, ...history.map(({ date, event }) => `${date} — ${event}`)].join("\n"),
    html: `<section lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}" style="margin:24px 0;overflow-wrap:anywhere;color:inherit">
      <h2>${heading}</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>${rows.map(([label, value, isMoney]) => `<tr><th scope="row" style="padding:9px 4px;text-align:start;border-bottom:1px solid #888;font-weight:normal${isMoney ? `;color:${moneyColors.onLight}` : ""}">${isMoney ? escape(label) : emailDisplayHtml(label, "onLight")}</th><td dir="auto" style="padding:9px 4px;text-align:end;border-bottom:1px solid #888${isMoney ? `;color:${moneyColors.onLight}` : ""}">${escape(isMoney ? formatMoneyNumber(value) : value)}</td></tr>`).join("")}</tbody></table>
      <p style="font-size:12px;line-height:1.6">${emailDisplayHtml(notice, "onLight")}</p><h3>${locale === "ar" ? "السجل عند الإتمام" : "History at completion"}</h3><ol style="padding-inline-start:24px">${history.map(({ date, event }) => `<li style="padding:5px 0">${escape(date)} — ${emailDisplayHtml(event, "onLight")}</li>`).join("")}</ol></section>`,
  };
}

/** Self-contained, printable UTF-8 document; no remote assets, scripts or bearer links. */
export function tradeReceiptDocument(receipt: TradeCompletionReceipt, locale: "ar" | "en") {
  return `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Alpha Traders — ${escape(receipt.tradeReference)}</title><style>body{font-family:Arial,sans-serif;margin:24px auto;padding:0 16px;max-width:760px;line-height:1.5;color:#171717}h1{border-bottom:3px solid #b28b35;padding-bottom:12px}tr{break-inside:avoid}@media print{body{margin:0;max-width:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}h2,h3{break-after:avoid}}</style></head><body><h1>Alpha Traders</h1>${renderTradeReceipt(receipt, locale).html}<p>${locale === "ar" ? "إيصال صفقة خاص. يمكنك طباعته أو حفظه كملف PDF من قائمة جهازك." : "Private trade receipt. Use your device’s print menu to print or save as PDF."}</p></body></html>`;
}
