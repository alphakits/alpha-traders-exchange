import type { NewsEvent, NewsLocale } from "./model";

// Plain-language context is separate from a numerical consensus forecast.
const context: [RegExp, string, string][] = [
  [/initial.*claims|jobless|unemployment claims/i, "New applications for unemployment benefits. Compare the published total with the previous week.", "طلبات جديدة للحصول على إعانة البطالة. قارن العدد المنشور بالأسبوع السابق."],
  [/core.*cpi|cpi.*core|cpi.*ex food|consumer price.*ex food/i, "Consumer price inflation excluding food and energy. Compare the new reading with the previous period.", "تضخم أسعار المستهلكين باستثناء الغذاء والطاقة. قارن القراءة الجديدة بالفترة السابقة."],
  [/cpi|consumer price|inflation rate/i, "Changes in consumer prices. Monthly and yearly figures measure different periods.", "التغير في أسعار المستهلكين. الأرقام الشهرية والسنوية تقيس فترات مختلفة."],
  [/ppi|producer price/i, "Changes in prices received by producers. Core figures exclude food and energy.", "التغير في الأسعار التي يحصل عليها المنتجون. المؤشر الأساسي يستثني الغذاء والطاقة."],
  [/retail sales/i, "A measure of consumer spending at retailers. The core reading excludes vehicle sales.", "مقياس لإنفاق المستهلكين لدى متاجر التجزئة. القراءة الأساسية تستثني مبيعات السيارات."],
  [/durable goods/i, "New orders for long-lasting manufactured goods. The core reading excludes transportation equipment.", "طلبات جديدة على السلع المصنّعة المعمّرة. القراءة الأساسية تستثني معدات النقل."],
  [/gdp|gross domestic/i, "A measure of economic growth. The advance estimate can be revised in later releases.", "مقياس للنمو الاقتصادي. قد تُراجع القراءة الأولية في الإصدارات التالية."],
  [/pce|personal consumption/i, "Inflation measured through consumer spending. Core figures exclude food and energy.", "التضخم المقاس من خلال إنفاق المستهلكين. المؤشر الأساسي يستثني الغذاء والطاقة."],
  [/hourly earnings/i, "Changes in average hourly wages. Compare wage growth with the previous month.", "التغير في متوسط الأجور بالساعة. قارن نمو الأجور بالشهر السابق."],
  [/unemployment/i, "The share of the labour force that is unemployed and seeking work.", "نسبة العاطلين عن العمل والباحثين عنه من إجمالي القوى العاملة."],
  [/payroll|non.?farm/i, "The change in nonfarm jobs. Earlier months can be revised alongside the new figure.", "التغير في عدد الوظائف غير الزراعية. قد تُراجع أرقام الأشهر السابقة مع صدور الرقم الجديد."],
  [/trade balance/i, "Exports minus imports. A negative balance means imports exceeded exports.", "الصادرات ناقص الواردات. الرصيد السالب يعني أن الواردات تجاوزت الصادرات."],
  [/minutes/i, "A record of an earlier Fed meeting. Watch for the discussion on inflation, jobs and interest rates; this is not a new rate decision.", "محضر اجتماع سابق للفيدرالي. تابع النقاش حول التضخم والتوظيف والفائدة؛ هذا ليس قرار فائدة جديدًا."],
  [/decision|interest rate/i, "The Fed's interest-rate decision and accompanying statement. Any numerical forecast is shown separately when available.", "قرار الفائدة للفيدرالي والبيان المصاحب له. يظهر التوقع الرقمي بشكل منفصل عند توفره."],
  [/employment cost/i, "Changes in the cost of wages and benefits paid by employers.", "التغير في تكلفة الأجور والمزايا التي يدفعها أصحاب العمل."],
];

export function newsEventContext(event: NewsEvent, locale: NewsLocale) {
  const match = context.find(([pattern]) => pattern.test(event.title));
  if (match) return match[locale === "ar" ? 2 : 1];
  if (event.kind === "speech") return locale === "ar"
    ? "تابع التصريحات المنشورة من الفيدرالي. يُعرض ملخص مؤكد عند توفره، ولا يوجد رقم نتيجة لهذا الحدث."
    : "Watch the Fed's published remarks. A verified summary appears when available; this event has no numerical result.";
  return locale === "ar" ? "قارن النتيجة المنشورة بالقراءة السابقة وبالتوقع الرقمي إن توفر." : "Compare the published result with the previous reading and any available numerical forecast.";
}
