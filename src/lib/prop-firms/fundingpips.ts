import { text as t, type FirmProgram, type PropFirm } from "./types";
const base="https://help.fundingpips.com/hc/en-us/articles/";
const modelSources=[
  {title:"2 Step Standard",url:base+"34501809112081-2-Step-Standard"},
  {title:"1 Step Flex",url:base+"34501697434385-1-Step-Flex"},
  {title:"2 Step Pro",url:base+"34502027344017-2-Step-Pro-Model"},
  {title:"2 Step Flex",url:base+"47835196271249-2-Step-Flex"},
  {title:"Zero",url:base+"34502157694865-FundingPips-Zero"},
];
const monthly=t("Monthly 100% (eligible accounts purchased from August 15, 2026): 30 calendar days, ≤35% consistency and 7 profitable days of ≥0.5% each. A 1% trade-idea warning system also applies; warnings can reduce the split or close the account.","الشهري 100% للحسابات المؤهلة المشتراة من 15 أغسطس 2026: 30 يوماً تقويمياً، اتساق ≤35%، و7 أيام رابحة ≥0.5% لكل يوم. يُطبّق نظام إنذارات لخسارة 1% بفكرة تداول؛ الإنذارات قد تخفض الحصة أو تغلق الحساب.");
const definitions=[
  {id:"two-step",name:"2 Step Standard",targets:[.08,.05],loss:.1,dll:.05,share:80,days:t("3 days per phase; none with the purchased 3% DLL add-on","3 أيام بكل مرحلة؛ دون حد أيام مع إضافة DLL 3% المشتراة"),tag:t("8% + 5% targets · choose a reward cycle","هدف 8% ثم 5% · اختار دورة المكافأة")},
  {id:"one-step-flex",name:"1 Step Flex",targets:[.12],loss:.12,dll:.03,share:85,days:t("No minimum trading days","دون حد أدنى لأيام التداول"),tag:t("One phase · 12% target","مرحلة واحدة · هدف 12%")},
  {id:"two-step-pro",name:"2 Step Pro",targets:[.06,.06],loss:.06,dll:.03,share:80,days:t("Confirmation needed: official page lists both 0 and 2 days for new accounts","يحتاج تأكيد: الصفحة الرسمية تذكر 0 ويومين للحسابات الجديدة"),tag:t("6% + 6% targets · 6% total loss limit","هدف 6% ثم 6% · حد خسارة كلي 6%")},
  {id:"two-step-flex",name:"2 Step Flex",targets:[.10,.08],loss:.12,dll:.04,share:80,days:t("Per phase: 1 day with 80% split, or 3 profitable days with 95% split","بكل مرحلة: يوم واحد لحصة 80%، أو 3 أيام رابحة لحصة 95%"),tag:t("10% + 8% targets · 80% or 95% bi-weekly","هدف 10% ثم 8% · 80% أو 95% كل أسبوعين")},
  {id:"zero",name:"Zero",targets:[],loss:.05,dll:.03,share:95,days:t("No evaluation","بدون امتحان"),tag:t("Instant simulated Master · 95% share","Master محاكاة مباشرة · حصة 95%")},
];
const programs:FirmProgram[]=definitions.map((d,i)=>({
  id:d.id,name:d.name,tagline:d.tag,
  tiers:[5000,10000,25000,50000,100000,...([2,4].includes(i)?[200000]:[])].map(size=>({size,targets:d.targets.map(target=>Math.round(size*target)),maxLoss:Math.round(size*d.loss),dailyLoss:Math.round(size*d.dll),minPayout:size*.01,buffer:i===4?size*.03:0})),
  evaluationDays:d.days,
  evaluationConsistency:d.id==="zero"?t("There is no evaluation stage. Master risk limits, consistency and reward requirements apply from the start.","ما في مرحلة امتحان. حدود المخاطرة والاتساق وشروط المكافأة لحساب Master تطبّق من البداية."):t("Evaluation profit-concentration conditions can add funded profitable-day requirements; see the account rules below.","شروط تركز ربح الامتحان قد تضيف أيام ربح مطلوبة بالمموّل؛ راجع قواعد الحساب أدناه."),
  drawdown:i===4?t("5% trails peak equity, locks at initial balance after 5% profit, and does not reset after rewards.","5% تتبع أعلى Equity، وتثبت عند الرصيد الابتدائي بعد ربح 5%، ولا تُصفّر بعد المكافأة."):t("Static total-loss floor. Daily loss uses the HIGHER opening balance/equity at 00:00 platform time (UTC+3). The amount shown is the initial-day example.","حد الخسارة الكلية ثابت. اليومية تُحسب من الأعلى بين رصيد وEquity افتتاح اليوم عند 00:00 بتوقيت المنصة UTC+3. المبلغ المعروض مثال لليوم الأول."),
  pricing:t("One-time purchase; price varies by model, size and add-ons. Confirm the configured fee on the official checkout. Reset discounts are model-specific and time-limited.","شراء مرة واحدة؛ السعر حسب البرنامج والحجم والإضافات. أكّد الرسوم بالإعدادات المختارة في الدفع الرسمي. خصم إعادة المحاولة يختلف حسب البرنامج والمدة."),
  activation:t("Complete KYC and the Master agreement in the dashboard. A 4th-reward registration-fee refund applies to 2 Step Standard only.","أكمل KYC واتفاقية Master بلوحة الشركة. استرداد رسوم التسجيل مع المكافأة الرابعة خاص بـ2 Step Standard فقط."),
  funded:[d.id==="zero"?t("Zero starts directly on a simulated Master account. Complete the account setup and respect its risk limits from your first trade; rewards require all of the conditions below.","Zero يبدأ مباشرة بحساب Master محاكاة. أكمل إعداد الحساب والتزم بحدود المخاطرة من أول صفقة؛ المكافآت تحتاج استيفاء كل الشروط أدناه."):t("All FundingPips accounts are simulated, including Zero and Master. A funded reward has its own conditions; passing the evaluation does not make evaluation profits withdrawable.","كل حسابات FundingPips محاكاة، بما فيها Zero وMaster. مكافأة المموّل لها شروط مستقلة؛ النجاح لا يجعل أرباح الامتحان قابلة للسحب.")],
  payoutDetails: i===0?[
    t("Weekly: 7 days / 60%. Bi-weekly: 14 days / 80%. Both have a 1% minimum reward request. On Demand: 90%, ≥2% reward request and ≤35% consistency.","أسبوعي: 7 أيام / 60%. كل أسبوعين: 14 يوماً / 80%. كلاهما بحد أدنى 1% للطلب. عند الطلب: 90%، طلب ≥2% واتساق ≤35%."),monthly,
  ]:i===1?[
    t("Bi-weekly: 14 days, 85% share and 1% minimum gross request.","كل أسبوعين: 14 يوماً، حصة 85% وحد أدنى 1% للطلب قبل حصة الشركة."),monthly,
  ]:i===2?[
    t("Weekly: every 7 calendar days, 80% share. Minimum reward request 1% of account size.","أسبوعي: كل 7 أيام تقويمية، حصة 80%. أقل طلب مكافأة 1% من حجم الحساب."),monthly,
  ]:i===3?[
    t("Bi-weekly: 14 days. Choose 80%, or 95% with 3 profitable days (≥0.5% each) per cycle. The purchased split is locked; no bi-weekly consistency score. Minimum request 1%.","كل أسبوعين: 14 يوماً. اختار 80%، أو 95% مع 3 أيام رابحة (≥0.5% لليوم) بكل دورة. الحصة المشتراة ثابتة؛ دون اتساق لدورة الأسبوعين. أقل طلب 1%."),monthly,
  ]:[
    t("Every 14 calendar days, 95% share. All conditions: ≤15% consistency; 7 profitable days (≥0.25% each) in the rolling 30-day period; keep the first 3% profit as a safety cushion; largest losing trade ≤ largest winning trade.","كل 14 يوماً تقويمياً، حصة 95%. كل الشروط مطلوبة: اتساق ≤15%؛ 7 أيام رابحة (≥0.25% لكل يوم) خلال فترة 30 يوماً المتحركة؛ إبقاء أول 3% ربح كهامش أمان؛ أكبر صفقة خاسرة ≤ أكبر صفقة رابحة."),
    t("Minimum reward request 1% of account size, above the protected 3% cushion. The rolling profitable-day requirement also matters for keeping the account active.","أقل طلب مكافأة 1% من حجم الحساب، فوق هامش 3% المحمي. شرط الأيام الرابحة المتحرك مهم أيضاً لبقاء الحساب نشطاً."),
  ],
  cautions:i===4?[
    t("Maximum open losing-position risk is 1% of initial capital; winning positions do not offset it. Trade-idea loss limits also apply: 3% below 50K, 2% from 50K.","أقصى مخاطرة للصفقات المفتوحة الخاسرة 1% من رأس المال الابتدائي؛ الرابحة لا تعوّضها. حد خسارة فكرة التداول أيضاً: 3% تحت 50K و2% من 50K."),
    t("Zero: no opening, closing or holding in the restricted news window (10 minutes either side; speeches through 10 minutes after the end). No weekend holding on any instrument. Thirty-day inactivity rule.","Zero: ممنوع فتح أو إغلاق أو حمل صفقة ضمن نافذة الأخبار المقيّدة (10 دقائق قبل وبعد؛ والخطابات حتى 10 دقائق بعد النهاية). ممنوع حمل الصفقات لنهاية الأسبوع بكل الأدوات. حد عدم النشاط 30 يوماً."),
  ]:[
    t("A trade idea exceeding 60% of an evaluation target can impose 4 profitable Master days (≥0.5% each) before every reward. Effective dates and affected account sizes must be checked in your model's source.","فكرة تداول تحقق أكثر من 60% من هدف الامتحان قد تفرض 4 أيام ربح بـMaster (≥0.5% لليوم) قبل كل مكافأة. راجع تاريخ السريان والأحجام المشمولة بمصدر برنامجك."),
    t("Master news windows can remove profits: ±5 minutes around restricted releases; 10 minutes before speeches to 10 minutes after they end. Trades opened ≥5 hours before an event have an exception. Thirty-day inactivity rule.","نوافذ أخبار Master قد تحذف الأرباح: 5 دقائق قبل وبعد الخبر المقيّد؛ و10 قبل الخطاب حتى 10 بعد نهايته. يوجد استثناء للصفقة المفتوحة قبل الحدث بـ5 ساعات أو أكثر. حد عدم النشاط 30 يوماً."),
    t("Check the purchased Swing add-on before holding overnight/weekends. Master auto-close and trade-idea loss/warning rules depend on model and reward cycle.","افحص إضافة Swing المشتراة قبل التبييت أو حمل الصفقات لنهاية الأسبوع. الإغلاق التلقائي وحد خسارة فكرة التداول والإنذارات حسب البرنامج ودورة المكافأة."),
    ...(i===2?[t("The Pro source currently contradicts itself on minimum evaluation days. Verify your purchase/reset date and the requirement shown on your dashboard before relying on a pass date.","مصدر Pro حالياً متناقض بخصوص أقل أيام الامتحان. أكّد تاريخ الشراء أو إعادة المحاولة والشرط الظاهر بلوحتك قبل اعتماد موعد للنجاح.")]:[]),
  ],
  payout:{mode:"dashboard",share:d.share,days:0,calendarDays:i===0||i===2?7:14},sources:[modelSources[i]],
}));
export const fundingpips:PropFirm={
  slug:"fundingpips",name:"FundingPips",short:"FP",accent:"#B3A0F5",market:t("Forex & CFDs","فوركس وعقود فروقات"),website:"https://fundingpips.com/",
  description:t("Five models, different reward cycles. Separate evaluation rules from Master requirements.","خمسة برامج ودورات مكافأة مختلفة. افصل شروط الامتحان عن شروط Master."),programs,
  receiving:[t("Close all trades and pending orders, wait at least 15 minutes, then Rewards → Request Reward → choose Master account, amount and method. Trading pauses during processing.","أغلق الصفقات والأوامر المعلّقة، انتظر 15 دقيقة على الأقل، ثم Rewards ← Request Reward ← اختار Master والمبلغ والطريقة. يتوقف التداول أثناء المعالجة."),t("Processing: 1–3 business days; allow another 1–2 for delivery, with some card methods taking 1–5 after approval. All receiving accounts must be in your own name.","المعالجة: 1–3 أيام عمل؛ أضف 1–2 للوصول، وبعض طرق البطاقة تحتاج 1–5 بعد الموافقة. الاستلام لازم يكون باسمك."),t("Methods: card, USDT/USDC on ERC20, Rise or bank transfer where supported. Rise/bank require at least $500 in addition to model minimums. Provider, network and conversion fees reduce the received amount.","الطرق: بطاقة، USDT/USDC على ERC20، أو Rise أو حوالة بنكية حسب التوفر. Rise والبنك يحتاجان $500 على الأقل إضافة لحد البرنامج. رسوم المزوّد والشبكة والتحويل تنقص الصافي.")],
  important:[t("Choose the exact purchased model and reward cycle. Historical 1 Step/2 Step terms differ. The calculator estimates the split of your dashboard-confirmed amount; it does not assess trade-idea warnings or rolling-day compliance.","اختار البرنامج المشتَرى ودورة المكافأة بالضبط. شروط 1 Step و2 Step القديمة مختلفة. الحاسبة تقدّر تقسيم المبلغ المؤكد بلوحتك؛ لا تفحص إنذارات فكرة التداول أو التزام الأيام المتحركة.")],
  sources:[...modelSources,{title:"Reward methods",url:base+"34504564970385-Reward-Methods"},{title:"Getting started & fee refunds",url:base+"44390730743825-Get-Started"},{title:"Legacy rules",url:base+"51307058233361-FundingPips-Legacy-Rules"}],
};
