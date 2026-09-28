import { text as t, type AccountTier, type FirmProgram, type PropFirm } from "./types";
const base = "https://help.myfundedfutures.com/en/articles/";
const evaluation = {title:"Current evaluation tables",url:base+"11802636-traders-evaluation-simplified"};
const payout = {title:"Payout policy overview",url:base+"13745661-payout-policy-overview-best-and-fastest-prop-firm-payouts"};
const builderSource = {title:"Builder 50K (both MLL options)",url:base+"14290805-builder-plan-50k-a-comprehensive-guide"};
const rapidSource = {title:"Rapid 50K",url:base+"13134709-rapid-plan-50k-a-comprehensive-look"};
const eodSource = {title:"Rapid EOD 50K",url:base+"16158363-rapid-eod-50k-a-comprehensive-look"};
const proSource = {title:"Pro funded & live rules",url:base+"11802674-pro-plan-sim-funded-and-live-account-highlights"};
const sizes = [25000,50000,100000,150000];
const tier = (i:number):AccountTier => ({size:sizes[i], targets:[[1500,3000,6000,9000][i]],maxLoss:[1000,2000,3000,4500][i],minPayout:500,buffer:[1100,2100,3100,4600][i]});
const common = {
  pricing:t("One-time fee; no renewals or activation fee. Published base prices exclude promotions. A missing price means the selected size needs a current checkout quote.","رسوم مرة واحدة؛ دون تجديد أو رسوم تفعيل. السعر الأساسي المنشور قبل العروض. إذا السعر غير معروض، افحص عرض السعر الحالي للحجم المختار."),
  activation:t("$0 activation. After passing, open the account's Stats page and choose Upgrade, then complete the funded setup.","تفعيل $0. بعد النجاح افتح Stats للحساب واضغط Upgrade ثم أكمل إعداد الحساب المموّل."),
  cautions:[t("Evaluation profits do not become withdrawable cash. Funded limits, news restrictions and inactivity rules apply separately. Live accounts have their own rules.","أرباح الامتحان لا تتحول لرصيد قابل للسحب. حدود المموّل وقيود الأخبار وعدم النشاط منفصلة. وحساب Live له قواعده.")],
};
const programs:FirmProgram[] = [
  {
    ...common,id:"rapid",name:"Rapid · Intraday",tagline:t("Daily payout cycle · 90% share","دورة سحب يومية · حصة 90%"),
    tiers:sizes.map((_,i)=>({...tier(i),contracts:[3,5,8,10][i],price:i===1?209:undefined})),
    evaluationDays:t("2 trading days minimum","يومان تداول على الأقل"),evaluationConsistency:t("50% in evaluation only","50% في الامتحان فقط"),
    drawdown:t("Evaluation: EOD. Sim Funded: intraday equity trailing; floor eventually locks at $100.","الامتحان: نهاية اليوم. Sim Funded: يتبع أعلى قيمة أثناء الجلسة؛ يستقر الحد لاحقاً عند $100."),
    funded:[t("Sim Funded starts at $0. Respect the account's intraday trailing loss limit, including unrealized gains. No DLL or funded consistency rule.","Sim Funded يبدأ من $0. التزم بالخسارة المتحركة أثناء الجلسة، بما فيها الأرباح المفتوحة. دون DLL أو اتساق في المموّل.")],
    payoutDetails:[
      t("First request: 24 hours after the first funded trade, once buffer and minimum are met. Thereafter, daily requests. Minimum $500; 90% trader share.","أول طلب بعد 24 ساعة من أول صفقة مموّلة وبعد استيفاء الهامش والحد الأدنى. بعدها طلبات يومية. أقل طلب $500؛ حصتك 90%."),
      t("Buffers: 25K $1,100; 50K $2,100; 100K $3,100; 150K $4,600. Use the dashboard's withdrawable amount after the first payout; the unlocked balance is not the same as lifetime profit.","الهوامش: 25K بقيمة $1,100؛ 50K بقيمة $2,100؛ 100K بقيمة $3,100؛ 150K بقيمة $4,600. بعد أول سحب استخدم المبلغ المتاح بلوحة الشركة؛ الرصيد المتاح مختلف عن مجموع الأرباح التاريخية."),
    ],
    payout:{mode:"dashboard",share:90,days:0,calendarDays:1},sources:[evaluation,rapidSource,payout],
    cautions:[...common.cautions,t("T1 news trading is allowed in evaluation, but not in Rapid Sim Funded. Follow the official news window.","تداول أخبار T1 مسموح بالامتحان وممنوع في Rapid Sim Funded. اتبع نافذة الأخبار الرسمية.")],
  },
  {
    ...common,id:"rapid-eod",name:"Rapid · EOD",tagline:t("Daily payout cycle · EOD drawdown","دورة سحب يومية · خسارة متحركة بنهاية اليوم"),
    tiers:[0,1].map(i=>({...tier(i),contracts:[2,3][i],price:i===1?209:undefined})),
    evaluationDays:t("4 trading days minimum","4 أيام تداول على الأقل"),evaluationConsistency:t("30% in evaluation only","30% في الامتحان فقط"),
    drawdown:t("EOD trailing in evaluation and Sim Funded. Funded floor eventually locks at $100.","خسارة متحركة بنهاية اليوم بالامتحان والمموّل. حد المموّل يستقر لاحقاً عند $100."),
    funded:[t("Sim Funded starts at $0. No DLL or funded consistency. Seven-calendar-day inactivity rule. T1 news trading is prohibited at funded stage.","Sim Funded يبدأ من $0. دون DLL أو اتساق بالمموّل. حد عدم النشاط 7 أيام تقويمية. تداول أخبار T1 ممنوع بمرحلة المموّل.")],
    payoutDetails:[t("Clear the buffer for the first payout. Later payouts unlock with $500 new net profit since the last payout. Minimum request $500; no per-cycle cap; 90% share.","تجاوز الهامش لأول سحب. السحوبات التالية تفتح مع $500 صافي ربح جديد منذ آخر سحب. أقل طلب $500؛ دون سقف للدورة؛ حصتك 90%."),t("Daily cycle. Confirm the available amount and next request time in the dashboard; do not subtract the first-payout buffer again as a universal rule for every cycle.","الدورة يومية. أكّد المبلغ المتاح وموعد الطلب التالي بلوحة الشركة؛ لا تخصم هامش أول سحب تلقائياً من كل دورة لاحقة.")],
    payout:{mode:"dashboard",share:90,days:0,calendarDays:1},sources:[evaluation,eodSource,payout],
  },
  {
    ...common,id:"builder",name:"Builder",tagline:t("1-day evaluation · 80% share","امتحان من يوم واحد · حصة 80%"),
    tiers:sizes.map((_,i)=>({...tier(i),contracts:[2,4,6,9][i],dailyLoss:[600,1000,1750,2500][i],price:i===1?153:undefined,minPayout:[250,500,1000,1500][i],caps:[[1000,2000,3000,4500][i]]})),
    evaluationDays:t("1 trading day minimum","يوم تداول واحد على الأقل"),evaluationConsistency:t("None in evaluation","لا يوجد في الامتحان"),
    drawdown:t("EOD trailing. The DLL is a soft session pause, not account failure.","متحرك بنهاية اليوم. DLL يوقف الجلسة مؤقتاً ولا يفشل الحساب."),
    funded:[t("Sim Funded starts at $0. News trading is allowed. Seven-calendar-day inactivity rule. Builder has its own active-account restrictions.","Sim Funded يبدأ من $0. تداول الأخبار مسموح. حد عدم النشاط 7 أيام تقويمية. Builder له قيود خاصة على عدد الحسابات النشطة.")],
    payoutDetails:[t("Each cycle: 2 trading days and ≤50% consistency. Clear the buffer plus the minimum request for the first payout; subsequent cycles require the minimum in new net profit since the previous payout.","كل دورة: يومان تداول واتساق ≤50%. لأول سحب تجاوز الهامش وأضف الحد الأدنى للطلب؛ الدورات التالية تحتاج الحد الأدنى كصافي ربح جديد منذ آخر سحب."),t("Up to 5 sim payouts with the size-specific cap, then eligibility for a live transition. 80% trader share. Builder 50K first request is after 48 hours and all other conditions.","حتى 5 سحوبات محاكاة بسقف حسب الحجم، ثم أهلية انتقال إلى Live. حصتك 80%. أول طلب Builder 50K بعد 48 ساعة واستيفاء باقي الشروط.")],
    payout:{mode:"dashboard",share:80,days:2,consistency:50,maxPayouts:5},sources:[evaluation,builderSource,{title:"Builder 25K",url:base+"17036130-builder-plan-25k-a-comprehensive-look"},{title:"Builder 100K",url:base+"17005296-builder-plan-100k-comprehensive-guide"},{title:"Builder 150K",url:base+"17035331-builder-plan-150k-comprehensive-guide"}],
  },
  {
    ...common,id:"builder-1500",name:"Builder 50K · $1,500 MLL",tagline:t("Smaller loss cushion · lower base fee","هامش خسارة أصغر · رسوم أساسية أقل"),
    tiers:[{...tier(1),maxLoss:1500,dailyLoss:1000,contracts:4,price:125,buffer:1600,caps:[2000]}],
    evaluationDays:t("1 trading day minimum","يوم تداول واحد على الأقل"),evaluationConsistency:t("None in evaluation","لا يوجد في الامتحان"),
    drawdown:t("$1,500 EOD trailing instead of $2,000","حد متحرك بنهاية اليوم $1,500 بدلاً من $2,000"),
    funded:[t("The selected $1,500 MLL carries into the funded stages. Other Builder 50K rules remain the same.","حد MLL المختار بقيمة $1,500 ينتقل للمراحل المموّلة. باقي قواعد Builder 50K نفسها.")],
    payoutDetails:[t("First request needs $2,100 profit: $1,600 buffer + $500 minimum. At least 2 days, 48 hours after first trade, and ≤50% consistency. $2,000 cap, 80% share, up to 5 sim payouts.","أول طلب يحتاج ربح $2,100: هامش $1,600 + حد أدنى $500. يومان على الأقل و48 ساعة من أول صفقة واتساق ≤50%. سقف $2,000، حصتك 80%، وحتى 5 سحوبات محاكاة."),t("Later cycles need $500 new net profit since the last payout; use the current available amount in your dashboard.","الدورات التالية تحتاج $500 صافي ربح جديد منذ آخر سحب؛ استخدم المبلغ المتاح الحالي بلوحة الشركة.")],
    payout:{mode:"dashboard",share:80,days:2,consistency:50,maxPayouts:5},sources:[builderSource,evaluation],
  },
  {
    ...common,id:"pro",name:"Pro",tagline:t("14-day payout cycle · 80% share","دورة سحب 14 يوماً · حصة 80%"),
    tiers:[1,2,3].map((i,n)=>({...tier(i),contracts:[3,6,9][n],price:i===1?265:undefined,minPayout:1000})),
    evaluationDays:t("2 trading days on the standard Pro evaluation","يومان تداول بامتحان Pro الأساسي"),evaluationConsistency:t("50% in evaluation; none in Sim Funded","50% بالامتحان؛ دون اتساق في Sim Funded"),
    drawdown:t("EOD trailing; no DLL in evaluation or Sim Funded","متحرك بنهاية اليوم؛ دون DLL بالامتحان أو Sim Funded"),
    funded:[t("Funded contracts follow the Pro scaling plan. T1 news trading is prohibited. A Live review can follow 3 payouts or a $20,000 profit milestone; transition is not automatic approval.","عقود المموّل حسب تدرّج Pro. تداول أخبار T1 ممنوع. ممكن مراجعة الانتقال إلى Live بعد 3 سحوبات أو ربح $20,000؛ المراجعة ليست موافقة تلقائية.")],
    payoutDetails:[t("Every 14 calendar days from the first trade. Minimum request $1,000. 80% share; $100,000 sim payout ceiling per user.","كل 14 يوماً تقويمياً من أول صفقة. أقل طلب $1,000. حصتك 80%؛ سقف سحب محاكاة $100,000 لكل مستخدم."),t("Standard buffers are $2,100 / $3,100 / $4,600. The policy also describes up to 60% withdrawals while inside the buffer. This exception needs the dashboard's available amount; a simple profit-minus-buffer formula would be misleading.","الهوامش الأساسية $2,100 / $3,100 / $4,600. السياسة تسمح أيضاً بسحب حتى 60% أثناء البقاء داخل الهامش. هذا الاستثناء يحتاج المبلغ المتاح بلوحة الشركة؛ طرح الهامش من الربح وحده قد يعطي نتيجة خاطئة."),t("The optional 50K One Day add-on raises the evaluation target to $4,000. This selector shows standard Pro; check the purchased add-on before applying its targets.","إضافة One Day الاختيارية لحجم 50K ترفع هدف الامتحان إلى $4,000. الاختيار هنا يعرض Pro الأساسي؛ راجع الإضافة المشتراة قبل تطبيق الهدف.")],
    payout:{mode:"dashboard",share:80,days:0,calendarDays:14},sources:[evaluation,proSource,payout],
  },
];
export const mffu:PropFirm = {
  slug:"my-funded-futures",name:"My Funded Futures",short:"MFFU",accent:"#75BFFA",market:t("Futures","عقود مستقبلية"),website:"https://myfundedfutures.com/",
  description:t("Rapid, Rapid EOD, Builder and Pro. Follow the buffer and payout rules for your exact plan.","Rapid وRapid EOD وBuilder وPro. اعرف هامش الربح وشروط السحب لبرنامجك بالضبط."),programs,
  receiving:[t("Complete Personal Settings → KYC, set up Riseworks, then request through the MFFU payout dashboard. US traders may have Plaid/ACH.","أكمل Personal Settings ثم KYC، وجهّز Riseworks، وبعدها اطلب من صفحة السحب في MFFU. Plaid/ACH قد تكون متاحة لمتداولي أمريكا."),t("Most approvals may be instant; allow 6–12 business hours for manual processing. First-time Rise agreements arrive by email. Delivery from Rise to a bank or crypto wallet has separate provider timing and fees.","كثير من الموافقات قد تكون فورية؛ المراجعة اليدوية قد تحتاج 6–12 ساعة عمل. اتفاقيات Rise لأول مرة تصلك بالبريد. التحويل من Rise للبنك أو محفظة الكريبتو له مدة ورسوم منفصلة.")],
  important:[t("Current Builder plans have a soft DLL. Older no-DLL Builder and legacy Flex accounts follow their own articles. Do not apply the current Builder table to a legacy account.","برامج Builder الحالية فيها DLL مؤقت. Builder القديم بدون DLL وFlex القديم لهما قواعدهما. لا تطبق جدول Builder الحالي على حساب Legacy.")],
  sources:[evaluation,payout,{title:"How to receive a payout",url:base+"11542406-guide-to-your-first-payout-quick-and-easy-process"},{title:"Current plan prices",url:"https://myfundedfutures.com/"}],
};
