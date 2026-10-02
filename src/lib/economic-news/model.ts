export type NewsLocale = "ar" | "en";
export type NewsEvent = {
  id: string;
  providerId: string;
  title: string;
  titleAr: string;
  scheduledAt: string;
  currency: "USD";
  impact: "high";
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  revised: string | null;
  reference: string | null;
  source: string;
  sourceUrl: string | null;
  providerUpdatedAt: string | null;
  syncedAt: string;
  timing: "exact" | "tentative";
  kind: "release" | "speech";
  corrected?: boolean;
};

export type NewsFeed = {
  status: "ready" | "stale" | "unavailable" | "not_configured";
  updatedAt: string | null;
  provider: string | null;
  events: NewsEvent[];
  mode?: "weekly";
  coverageEnd?: string;
  weekStart?: string;
  weekEnd?: string;
};

export type NewsPreferences = { inApp: boolean; email: boolean };
export const NEWS_STALE_AFTER_MS = 3 * 60_000;
export const WEEKLY_NEWS_STALE_AFTER_MS = 8 * 86_400_000;
export const NEWS_RELEASE_ALERT_WINDOW_MS = 15 * 60_000;

export function newsEventId(raw: unknown): string | undefined {
  return typeof raw === "string" && /^(?:te-\d{1,24}|fxs-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|official-(?:bls|bea|dol|fed|census)-[a-z0-9-]{1,64})$/.test(raw) ? raw : undefined;
}

export function newsFeedStaleAfterMs(feed: NewsFeed) {
  return feed.mode === "weekly" ? WEEKLY_NEWS_STALE_AFTER_MS : NEWS_STALE_AFTER_MS;
}

const ARABIC_TITLES: Record<string, string> = {
  "non farm payrolls": "الوظائف في القطاعات غير الزراعية",
  "non-farm employment change": "التغير في الوظائف غير الزراعية",
  "unemployment rate": "معدل البطالة",
  "inflation rate yoy": "معدل التضخم السنوي",
  "inflation rate mom": "معدل التضخم الشهري",
  "core inflation rate yoy": "معدل التضخم الأساسي السنوي",
  "core inflation rate mom": "معدل التضخم الأساسي الشهري",
  "cpi m/m": "مؤشر أسعار المستهلكين — شهري",
  "cpi y/y": "مؤشر أسعار المستهلكين — سنوي",
  "core cpi m/m": "مؤشر أسعار المستهلكين الأساسي — شهري",
  "fed interest rate decision": "قرار الفائدة للاحتياطي الفيدرالي",
  "fomc economic projections": "التوقعات الاقتصادية للاحتياطي الفيدرالي",
  "fomc statement": "بيان اللجنة الفيدرالية للسوق المفتوحة",
  "fomc press conference": "المؤتمر الصحفي للاحتياطي الفيدرالي",
  "fomc minutes": "محضر اجتماع اللجنة الفيدرالية للسوق المفتوحة",
  "fed chair powell speech": "خطاب رئيس الاحتياطي الفيدرالي باول",
  "fed chair powell speaks": "خطاب رئيس الاحتياطي الفيدرالي باول",
  "retail sales mom": "مبيعات التجزئة — شهري",
  "retail sales ex autos mom": "مبيعات التجزئة باستثناء السيارات — شهري",
  "initial jobless claims": "طلبات إعانة البطالة الأولية",
  "unemployment claims": "طلبات إعانة البطالة",
  "gdp growth rate qoq adv": "نمو الناتج المحلي الإجمالي — التقدير الأولي ربع السنوي",
  "gdp growth rate qoq 2nd est": "نمو الناتج المحلي الإجمالي — التقدير الثاني ربع السنوي",
  "gdp growth rate qoq final": "نمو الناتج المحلي الإجمالي — التقدير النهائي ربع السنوي",
  "core pce price index mom": "مؤشر أسعار نفقات الاستهلاك الشخصي الأساسي — شهري",
  "core pce price index yoy": "مؤشر أسعار نفقات الاستهلاك الشخصي الأساسي — سنوي",
  "ism manufacturing pmi": "مؤشر مديري المشتريات الصناعي — ISM",
  "ism services pmi": "مؤشر مديري المشتريات للخدمات — ISM",
  "ism non-manufacturing pmi": "مؤشر مديري المشتريات غير الصناعي — ISM",
  "adp employment change": "تغير التوظيف في القطاع الخاص — ADP",
  "jolts job openings": "فرص العمل الشاغرة — JOLTS",
  "cb consumer confidence": "ثقة المستهلك — مجلس المؤتمرات",
  "ppi mom": "مؤشر أسعار المنتجين — شهري",
  "ppi yoy": "مؤشر أسعار المنتجين — سنوي",
  "core ppi mom": "مؤشر أسعار المنتجين الأساسي — شهري",
  "average hourly earnings mom": "متوسط الأجر في الساعة — شهري",
  "nonfarm payrolls": "الوظائف في القطاعات غير الزراعية",
  "consumer price index (mom)": "مؤشر أسعار المستهلكين — شهري",
  "consumer price index (yoy)": "مؤشر أسعار المستهلكين — سنوي",
  "consumer price index ex food & energy (mom)": "مؤشر أسعار المستهلكين الأساسي — شهري",
  "consumer price index ex food & energy (yoy)": "مؤشر أسعار المستهلكين الأساسي — سنوي",
  "retail sales (mom)": "مبيعات التجزئة — شهري",
  "gross domestic product annualized": "الناتج المحلي الإجمالي بالمعدل السنوي",
  "core personal consumption expenditures - price index (mom)": "مؤشر أسعار نفقات الاستهلاك الشخصي الأساسي — شهري",
  "core personal consumption expenditures - price index (yoy)": "مؤشر أسعار نفقات الاستهلاك الشخصي الأساسي — سنوي",
  "average hourly earnings (mom)": "متوسط الأجر في الساعة — شهري",
  "average hourly earnings (yoy)": "متوسط الأجر في الساعة — سنوي",
};

export function arabicEventTitle(title: string) {
  // Unrecognized source titles stay verbatim, rather than inventing a translation.
  return ARABIC_TITLES[title.toLowerCase().trim()] ?? title;
}

export function newsEventTitle(event: NewsEvent, locale: NewsLocale) {
  return locale === "ar" ? event.titleAr : event.title;
}

export function newsEventStatus(event: NewsEvent, now: number) {
  if (event.actual !== null && Date.parse(event.scheduledAt) <= now) return "released";
  if (event.timing === "tentative") return "tentative";
  if (Date.parse(event.scheduledAt) > now) return "scheduled";
  return event.kind === "speech" ? "no_numeric_result" : "awaiting";
}

export function newsDayKey(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  // Calendar filtering compares ISO dates. Locale punctuation/order can vary
  // between browser ICU versions, including the installed iOS app's WebView.
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

export function newsWeekRange(now: number, timeZone: string) {
  // Work with local calendar dates, so DST never turns a week into 6 or 8 days.
  const date = new Date(`${newsDayKey(new Date(now).toISOString(), timeZone)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return { start, end: date.toISOString().slice(0, 10) };
}

export function newsResultSummary(event: NewsEvent, locale: NewsLocale) {
  if (event.actual === null) return "";
  const isAr = locale === "ar";
  const parts = [`${isAr ? "النتيجة" : "Actual"}: ${event.actual}`];
  if (event.forecast !== null) parts.push(`${isAr ? "المتوقع" : "Forecast"}: ${event.forecast}`);
  if (event.previous !== null) parts.push(`${isAr ? "السابق" : "Previous"}: ${event.previous}`);
  // Describe the data without making a directional trade recommendation.
  const numeric = /^([+-]?[\d,]+(?:\.\d+)?)([%KMBT]?)$/i;
  const actual = numeric.exec(event.actual);
  const forecast = event.forecast === null ? null : numeric.exec(event.forecast);
  if (actual && forecast && actual[2].toUpperCase() === forecast[2].toUpperCase()) {
    const a = Number(actual[1].replaceAll(",", ""));
    const f = Number(forecast[1].replaceAll(",", ""));
    parts.push(a > f ? (isAr ? "أعلى من المتوقع" : "Above forecast")
      : a < f ? (isAr ? "أقل من المتوقع" : "Below forecast")
        : (isAr ? "مطابق للتوقعات" : "In line with forecast"));
  }
  return parts.join(" · ");
}

export function shouldAlertForRelease(previous: NewsEvent | undefined, next: NewsEvent, now: number, initialized: boolean) {
  const age = now - Date.parse(next.scheduledAt);
  // An unknown source-update time must never turn stale data into a new alert.
  if (!next.providerUpdatedAt) return false;
  const sourceAge = now - Date.parse(next.providerUpdatedAt);
  return initialized && next.actual !== null && previous?.actual == null
    && next.timing === "exact" && age >= 0 && sourceAge >= -60_000 && sourceAge <= NEWS_RELEASE_ALERT_WINDOW_MS
    && (previous !== undefined || age <= NEWS_RELEASE_ALERT_WINDOW_MS);
}
