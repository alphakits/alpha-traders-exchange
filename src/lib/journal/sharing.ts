import { metrics, money, netPnl, type JournalLocale, type JournalReview, type JournalSettings, type JournalTrade } from "./model";

export type ShareField = { key: string; label: string; value: string; selected: boolean; tone?: "positive" | "negative" };
export type JournalShare = { title: string; context: string; fields: ShareField[] };
const resultTone = (cents: number) => cents > 0 ? "positive" as const : cents < 0 ? "negative" as const : undefined;

/** Explicit allow-list: never serialize a record, account ID, attachment URL or whole snapshot for sharing. */
export function tradeShare(trade: JournalTrade, locale: JournalLocale): JournalShare {
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const fields: ShareField[] = [
    { key: "symbol", label: t("Instrument", "الأداة"), value: trade.symbol, selected: true },
    { key: "date", label: t("Date", "التاريخ"), value: trade.date, selected: true },
    { key: "direction", label: t("Direction", "الاتجاه"), value: trade.direction === "long" ? t("Long", "شراء") : t("Short", "بيع"), selected: true },
    { key: "status", label: t("Status", "الحالة"), value: trade.status === "closed" ? t("Closed", "مغلقة") : t("Open · result not realized", "مفتوحة · النتيجة غير محققة"), selected: true },
  ];
  if (trade.status === "closed") fields.push({ key: "net", label: t("Net P&L after fees", "صافي النتيجة بعد الرسوم"), value: money(netPnl(trade), locale, true), selected: true, tone: resultTone(netPnl(trade)) });
  const optional = (key: string, label: string, value: string | null) => { if (value) fields.push({ key, label, value, selected: false }); };
  optional("time", t("Entry time", "وقت الدخول"), trade.time);
  optional("setup", t("Setup", "الإعداد"), trade.strategy);
  optional("fees", t("Fees", "الرسوم"), money(trade.feesCents, locale));
  optional("risk", t("Initial risk", "المخاطرة الأولية"), trade.riskCents === null ? null : money(trade.riskCents, locale));
  for (const [key, en, ar] of [["quantity", "Quantity", "الحجم"], ["entry", "Entry price", "سعر الدخول"], ["exit", "Exit price", "سعر الخروج"], ["stop", "Stop loss", "وقف الخسارة"], ["target", "Take profit", "جني الأرباح"]] as const) optional(key, t(en, ar), trade[key] === null ? null : String(trade[key]));
  optional("notes", t("Trade notes", "ملاحظات الصفقة"), trade.notes);
  return { title: t("Trade", "صفقة"), context: "", fields };
}

export function resultsShare(trades: JournalTrade[], context: string, locale: JournalLocale, review?: JournalReview): JournalShare {
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const s = metrics(trades);
  const fields: ShareField[] = [
    { key: "net", label: t("Net P&L after fees", "صافي النتيجة بعد الرسوم"), value: money(s.net, locale, true), tone: resultTone(s.net), selected: true },
    { key: "closed", label: t("Closed trades", "الصفقات المغلقة"), value: String(s.count), selected: true },
    { key: "winRate", label: t("Win rate", "نسبة الفوز"), value: s.winRate === null ? "—" : `${s.winRate.toFixed(1)}%`, selected: true },
    { key: "outcomes", label: t("Wins / losses / break-even", "رابحة / خاسرة / تعادل"), value: `${s.wins} / ${s.lossCount} / ${s.breakeven}`, selected: false },
    { key: "open", label: t("Open trades", "الصفقات المفتوحة"), value: String(s.open), selected: false },
    { key: "fees", label: t("Fees on closed trades", "رسوم الصفقات المغلقة"), value: money(s.fees, locale), selected: false },
    { key: "drawdown", label: t("Max drawdown", "أكبر تراجع"), value: money(s.maxDrawdown, locale), selected: false },
    { key: "factor", label: t("Profit factor", "معامل الربح"), value: s.profitFactor === null ? (s.gains ? t("No losses", "بلا خسائر") : "—") : s.profitFactor.toFixed(2), selected: false },
    { key: "r", label: t("Average realized R", "متوسط R المحقق"), value: s.averageR === null ? "—" : `${s.averageR.toFixed(2)}R`, selected: false },
    { key: "plan", label: t("Plan adherence", "الالتزام بالخطة"), value: s.discipline === null ? "—" : `${s.discipline.toFixed(1)}%`, selected: false },
  ];
  if (review) {
    for (const [key, en, ar] of [["preparation", "Preparation", "التحضير"], ["wentWell", "What went well", "ما سار بشكل جيد"], ["improve", "What to improve", "ما يحتاج إلى تحسين"], ["nextSession", "Next focus", "التركيز القادم"]] as const) {
      if (review[key]) fields.push({ key, label: t(en, ar), value: review[key], selected: false });
    }
    if (review.rating !== null) fields.push({ key: "rating", label: t("Execution rating", "تقييم التنفيذ"), value: `${review.rating}/5`, selected: false });
  }
  return { title: t("Trading results", "نتائج التداول"), context, fields };
}

export function rulesShare(settings: JournalSettings, locale: JournalLocale): JournalShare {
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  return { title: t("My trading plan", "خطة تداولي"), context: "", fields: [
    ...(settings.rules ? [{ key: "rules", label: t("My rules", "قواعدي"), value: settings.rules, selected: true }] : []),
    { key: "loss", label: t("Daily loss limit", "حد الخسارة اليومي"), value: money(settings.dailyLossLimitCents, locale), selected: false },
    { key: "maxTrades", label: t("Maximum trades per day", "أقصى عدد صفقات يومياً"), value: String(settings.maxTradesPerDay), selected: false },
  ] };
}

export function selectedShare(doc: JournalShare, selectedKeys: ReadonlySet<string>): JournalShare {
  return { title: doc.title, context: doc.context, fields: doc.fields.filter(field => selectedKeys.has(field.key)).map(({ key, label, value, tone }) => ({ key, label, value, tone, selected: true })) };
}
export function shareText(doc: JournalShare) {
  return ["Alpha Traders · Trading Journal", doc.title, doc.context, ...doc.fields.map(field => `${field.label}: ${field.value}`)].filter(Boolean).join("\n\n");
}
