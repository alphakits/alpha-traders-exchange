export type LessonNarrative = {
  intro: string;
  introAr: string;
  keyConcepts: string[];
  keyConceptsAr: string[];
  practicalExamples: string[];
  practicalExamplesAr: string[];
  beginnerMistakes: string[];
  beginnerMistakesAr: string[];
  workbookIntro: string;
  workbookIntroAr: string;
  quizContext: string;
  quizContextAr: string;
  visuals: Array<{
    src: string;
    title: string;
    titleAr: string;
  }>;
};

export const courseSource = {
  homepage: {
    pathTitle: "Built directly from the founder's course",
    pathTitleAr: "مبني مباشرة من دورة المؤسس",
    pathBody:
      "Alpha Traders teaches the path exactly as it is delivered inside the academy: start with Japanese candles, move into chart patterns, support and resistance, trendline reading, then bring everything together inside one complete strategy and timeframe model.",
    pathBodyAr:
      "Alpha Traders يعلّم المسار كما هو داخل الدورة نفسها: تبدأ بالشموع اليابانية، ثم النماذج الفنية، ثم الدعم والمقاومة، ثم الترندلاين، ثم تجمع كل شيء داخل استراتيجية كاملة ومنطق واضح للفريمات.",
    forWhoTitle: "Who this academy is for",
    forWhoTitleAr: "لمن صُممت هذه الأكاديمية",
    forWho: [
      "Students who want a structured path instead of random trading videos",
      "Beginners who need chart reading from the ground up",
      "Traders who want one workflow that connects candles, patterns, levels, and execution",
    ],
    forWhoAr: [
      "لمن يريد مساراً منظماً بدلاً من فيديوهات تداول عشوائية",
      "للمبتدئ الذي يحتاج فهم الشارت من الأساس",
      "ولمن يريد ربط الشموع والنماذج والمستويات والتنفيذ داخل خطة واحدة",
    ],
    whyFreeTitle: "Why the academy exists",
    whyFreeTitleAr: "لماذا وُجدت الأكاديمية",
    whyFree:
      "The founder's message is clear: the mission is not to sell dreams, but to teach trading correctly and systematically to anyone serious about learning.",
    whyFreeAr:
      "رسالة المؤسس واضحة: الهدف ليس بيع الأحلام، بل تعليم التداول بشكل صحيح ومنظم لكل شخص جاد في التعلّم.",
    learnTitle: "What you'll learn in Alpha Traders",
    learnTitleAr: "ماذا ستتعلم في Alpha Traders؟",
    learnSubtitle:
      "A structured learning journey that starts with the foundations and ends with a complete trading strategy.",
    learnSubtitleAr:
      "رحلة تعليمية منظمة تبدأ من الأساسيات وتنتهي ببناء استراتيجية تداول متكاملة.",
    learnCards: [
      {
        title: "Technical Analysis",
        titleAr: "التحليل الفني",
        body: "Learn how to read charts professionally through the same chart logic used throughout the founder's course.",
        bodyAr: "تعلّم قراءة الشارت باحتراف من خلال نفس المنطق التطبيقي المستخدم داخل دورة المؤسس.",
        topics: [
          "Candlestick patterns",
          "Support & Resistance",
          "Trendlines",
          "Market Structure",
          "Chart Patterns",
          "Technical confirmation",
        ],
        topicsAr: [
          "نماذج الشموع",
          "الدعم والمقاومة",
          "الترندلاين",
          "هيكل السوق",
          "النماذج الفنية",
          "التأكيد الفني",
        ],
        href: "/lessons/candles-foundation",
        visualSrc: "/images/course-materials/webp/image48.webp",
        visualTitle: "Support and resistance chart",
        visualTitleAr: "شارت الدعم والمقاومة",
      },
      {
        title: "Capital Management",
        titleAr: "إدارة رأس المال",
        body: "Learn to protect capital before chasing profit so every trade is framed by risk, discipline, and preservation.",
        bodyAr: "تعلّم حماية رأس المال قبل البحث عن الربح حتى تكون كل صفقة مبنية على المخاطرة والانضباط والحفاظ على الحساب.",
        topics: [
          "Risk Management",
          "Position Sizing",
          "Risk-to-Reward",
          "Capital Preservation",
          "Trade Management",
        ],
        topicsAr: [
          "إدارة المخاطر",
          "حجم الصفقة",
          "العائد مقابل المخاطرة",
          "حماية رأس المال",
          "إدارة الصفقة",
        ],
        href: "/founder",
        visualSrc: "/images/course-materials/webp/image50.webp",
        visualTitle: "Support level reaction example",
        visualTitleAr: "مثال تفاعل عند مستوى دعم",
      },
      {
        title: "Trading Psychology",
        titleAr: "علم النفس التداولي",
        body: "Build the mindset needed for consistency by learning patience, emotional control, and disciplined execution.",
        bodyAr: "ابنِ العقلية المطلوبة للاستمرارية عبر الصبر، وضبط المشاعر، والتنفيذ بانضباط.",
        topics: [
          "Emotional discipline",
          "Patience",
          "Avoiding FOMO",
          "Building confidence",
          "Trading routines",
        ],
        topicsAr: [
          "الانضباط العاطفي",
          "الصبر",
          "تجنب FOMO",
          "بناء الثقة",
          "روتين التداول",
        ],
        href: "/founder",
        visualSrc: "/images/course-materials/webp/image34.webp",
        visualTitle: "Pattern discipline visual reference",
        visualTitleAr: "مرجع بصري لانضباط النمط",
      },
      {
        title: "Building a Complete Strategy",
        titleAr: "بناء استراتيجية متكاملة",
        body: "See how candles, patterns, levels, confirmations, and execution combine into one repeatable trading workflow.",
        bodyAr: "اكتشف كيف تتجمع الشموع والنماذج والمستويات وعناصر التأكيد والتنفيذ داخل تدفق تداول واحد قابل للتكرار.",
        topics: [
          "Multi-timeframe analysis",
          "Entry confirmation",
          "Exit planning",
          "Trade execution",
          "Full strategy workflow",
        ],
        topicsAr: [
          "تحليل متعدد الفريمات",
          "تأكيد الدخول",
          "تخطيط الخروج",
          "تنفيذ الصفقة",
          "تدفق الاستراتيجية الكاملة",
        ],
        href: "/lessons/full-strategy-time-frame-explained",
        visualSrc: "/images/course-materials/webp/image53.webp",
        visualTitle: "Trendline strategy reference",
        visualTitleAr: "مرجع الترندلاين داخل الاستراتيجية",
      },
    ],
    visualCurriculumTitle: "Visual Learning From the Course Workbook",
    visualCurriculumTitleAr: "تعلم بصري مباشر من ملفات الدورة",
    visualCurriculumBody:
      "These graphics come directly from the course documents and are placed here so students can understand the framework before opening each lesson.",
    visualCurriculumBodyAr:
      "هذه الرسوم مأخوذة مباشرة من ملفات الدورة، وتم عرضها هنا حتى يفهم الطالب إطار العمل قبل الدخول لكل درس.",
    visualShowcase: [
      {
        src: "/images/course-materials/webp/image4.webp",
        title: "Reversal Candlestick Setups",
        titleAr: "نماذج الشموع الانعكاسية",
        caption:
          "Clear reversal structures used in the candles module to avoid random entries.",
        captionAr:
          "نماذج انعكاسية واضحة داخل وحدة الشموع لتجنب الدخول العشوائي.",
        href: "/lessons/candles-foundation",
      },
      {
        src: "/images/course-materials/webp/image32.webp",
        title: "Head and Shoulders Context",
        titleAr: "سياق الرأس والكتفين",
        caption:
          "Pattern context that ties chart shape to confirmation instead of guesswork.",
        captionAr:
          "سياق النموذج الذي يربط شكل الشارت بعناصر التأكيد بدل التخمين.",
        href: "/lessons/chart-patterns-rsi-integration",
      },
      {
        src: "/images/course-materials/webp/image49.webp",
        title: "Level Mapping and Reaction",
        titleAr: "تحديد المستويات وقراءة التفاعل",
        caption:
          "Support/resistance zones and how reaction quality defines execution decisions.",
        captionAr:
          "مناطق الدعم والمقاومة وكيف تحدد جودة التفاعل قرار التنفيذ.",
        href: "/lessons/support-resistance-engine",
      },
      {
        src: "/images/course-materials/webp/image53.webp",
        title: "Trendline Confirmation Workflow",
        titleAr: "تدفق تأكيد الترندلاين",
        caption:
          "Trendline used as confluence with structure before entering the trade.",
        captionAr:
          "استخدام الترندلاين كعنصر تأكيد مع الهيكل قبل الدخول في الصفقة.",
        href: "/lessons/full-strategy-time-frame-explained",
      },
    ],
  },
  founder: {
    philosophy:
      "Alpha Traders was created to turn trading education into a structured path: understand the candle, recognize the pattern, mark the level, validate the trendline, then execute the full strategy with discipline.",
    philosophyAr:
      "تم إنشاء Alpha Traders لتحويل تعلم التداول إلى مسار واضح: افهم الشمعة، تعرّف على النموذج، حدّد المستوى، أكّد بالترندلاين، ثم نفّذ الاستراتيجية كاملة بانضباط.",
    free:
      "The academy is free because the founder wants the method itself to be accessible. The value is already inside the course materials, and the student's responsibility is to study in order and apply with discipline.",
    freeAr:
      "الأكاديمية مجانية لأن المؤسس يريد أن تكون المنهجية نفسها متاحة. القيمة موجودة بالفعل داخل مواد الدورة، ومسؤولية الطالب أن يدرس بالترتيب ويطبّق بانضباط.",
    expectations: [
      "Move through the lessons in order",
      "Use the workbook beside every lesson",
      "Do not treat patterns or indicators as random signals",
      "Respect risk before looking for profit",
    ],
    expectationsAr: [
      "السير داخل الدروس بالترتيب",
      "استخدام كراسة العمل بجانب كل درس",
      "عدم التعامل مع النماذج أو المؤشرات كإشارات عشوائية",
      "احترام المخاطرة قبل البحث عن الربح",
    ],
  },
  courseBySlug: {
    "alpha-traders-complete-strategy": {
      value: [
        "Japanese candlesticks and reversal/continuation behavior",
        "Chart patterns for reversals and continuations",
        "Support and resistance levels with reaction reading",
        "Trendline confirmation",
        "A final full-strategy lesson that explains timeframe logic",
      ],
      valueAr: [
        "الشموع اليابانية وسلوك الانعكاس والاستمرارية",
        "النماذج الفنية للانعكاس والاستمرار",
        "الدعم والمقاومة مع قراءة التفاعل",
        "تأكيد الترندلاين",
        "درس نهائي للاستراتيجية الكاملة وشرح الفريمات",
      ],
      startWhy:
        "This track is valuable because it follows one consistent order: build chart literacy first, then learn confluence, then apply everything inside a complete trading model.",
      startWhyAr:
        "قيمة هذا المسار أنه يتبع ترتيباً واحداً ثابتاً: بناء فهم الشارت أولاً، ثم تعلّم عناصر التأكيد، ثم تطبيق الجميع داخل نموذج تداول كامل.",
    },
  },
} as const;

export const lessonNarratives: Record<string, LessonNarrative> = {
  "candles-foundation": {
    intro:
      "The founder starts this part of the course with Japanese candlesticks because every decision later in the academy depends on reading the candle correctly.",
    introAr:
      "يبدأ المؤسس هذا الجزء من الدورة بالشموع اليابانية لأن كل قرار لاحق داخل الأكاديمية يعتمد على قراءة الشمعة بشكل صحيح.",
    keyConcepts: [
      "Candlestick body and wick structure",
      "Reversal candlestick patterns",
      "Neutral candlestick behavior such as doji",
      "Continuation candlestick patterns",
    ],
    keyConceptsAr: [
      "جسم الشمعة والظلال",
      "نماذج الشموع الانعكاسية",
      "الشموع الحيادية مثل الدوجي",
      "نماذج الشموع الاستمرارية",
    ],
    practicalExamples: [
      "Hammer reversal examples",
      "Morning star and evening star confirmation",
      "Three white soldiers and three black crows",
      "Rising and falling three methods as continuation context",
    ],
    practicalExamplesAr: [
      "أمثلة المطرقة الانعكاسية",
      "تأكيد نموذج نجمة الصباح ونجمة المساء",
      "ثلاثة جنود بيض وثلاث غربان سود",
      "نماذج Rising/Falling Three Methods كسياق استمراري",
    ],
    beginnerMistakes: [
      "Treating every candle as a signal without context",
      "Ignoring whether the pattern is reversal, neutral, or continuation",
      "Entering before the candle behavior is confirmed",
    ],
    beginnerMistakesAr: [
      "اعتبار كل شمعة إشارة بدون سياق",
      "تجاهل ما إذا كان النموذج انعكاسياً أو حيادياً أو استمراريًا",
      "الدخول قبل تأكيد سلوك الشمعة",
    ],
    workbookIntro:
      "Use the workbook here to label each candle category and connect it to what the price did after the pattern appeared.",
    workbookIntroAr:
      "استخدم كراسة العمل هنا لتصنيف كل نوع شموع وربطه بما فعله السعر بعد ظهور النموذج.",
    quizContext:
      "The quiz checks whether you can separate candle structure from random pattern memorization.",
    quizContextAr:
      "الاختبار هنا يتأكد أنك تفرق بين فهم بنية الشمعة وبين مجرد حفظ الأشكال عشوائياً.",
    visuals: [
      { src: "/images/course-materials/image2.png", title: "Japanese Candlestick Overview", titleAr: "نظرة عامة على الشموع اليابانية" },
      { src: "/images/course-materials/image4.png", title: "Reversal Candlestick Patterns", titleAr: "نماذج الشموع الانعكاسية" },
      { src: "/images/course-materials/image9.png", title: "Morning Star", titleAr: "نجمة الصباح" },
      { src: "/images/course-materials/image13.png", title: "Three White Soldiers", titleAr: "ثلاثة جنود بيض" },
      { src: "/images/course-materials/image18.png", title: "Doji", titleAr: "دوجي" },
      { src: "/images/course-materials/image23.png", title: "Falling Three Methods", titleAr: "Falling Three Methods" },
    ],
  },
  "trendline-precision": {
    intro:
      "After candles and levels, the founder introduces trendline as a confirmation tool, not as a shortcut for predicting the market.",
    introAr:
      "بعد الشموع والمستويات، يقدّم المؤسس الترندلاين كأداة تأكيد وليس كاختصار للتنبؤ بالسوق.",
    keyConcepts: [
      "Trendline anchor discipline",
      "Reading slope with market structure",
      "Using trendline as confluence rather than a standalone trigger",
    ],
    keyConceptsAr: [
      "الانضباط في نقاط رسم الترندلاين",
      "قراءة الميل مع هيكل السوق",
      "استخدام الترندلاين كعنصر تأكيد لا كمشغل مستقل",
    ],
    practicalExamples: [
      "Drawing the line from valid swing points",
      "Waiting for price interaction instead of forcing a line to fit",
      "Combining trendline reaction with candle confirmation",
    ],
    practicalExamplesAr: [
      "رسم الخط من قمم وقيعان صحيحة",
      "انتظار تفاعل السعر بدلاً من إجبار الخط على التطابق",
      "دمج تفاعل الترندلاين مع تأكيد الشموع",
    ],
    beginnerMistakes: [
      "Connecting random highs and lows",
      "Using visual symmetry instead of structure",
      "Entering because of the line without confirmation from price",
    ],
    beginnerMistakesAr: [
      "ربط قمم وقيعان عشوائية",
      "استخدام الشكل البصري بدلاً من الهيكل",
      "الدخول بسبب الخط وحده بدون تأكيد سعري",
    ],
    workbookIntro:
      "The workbook in this module should be used to compare valid trendlines against overfitted ones.",
    workbookIntroAr:
      "يجب استخدام الكراسة في هذه الوحدة لمقارنة الترندلاين الصحيح بالترندلاين المبالغ في تفصيله.",
    quizContext:
      "The quiz focuses on whether you understand trendline discipline, not whether you can draw random diagonal lines.",
    quizContextAr:
      "يركز الاختبار على فهمك لانضباط الترندلاين، لا على رسم خطوط مائلة عشوائية.",
    visuals: [
      { src: "/images/course-materials/image53.png", title: "Trendline Example", titleAr: "مثال على الترندلاين" },
    ],
  },
  "support-resistance-engine": {
    intro:
      "The course explains support and resistance as practical reaction zones that act like a floor and a ceiling in price behavior.",
    introAr:
      "تشرح الدورة الدعم والمقاومة كمناطق تفاعل عملية تعمل كسقف وأرضية في سلوك السعر.",
    keyConcepts: [
      "Support level as a demand floor",
      "Resistance level as a selling ceiling",
      "Reaction strength around levels",
      "Combining levels with reversal patterns",
    ],
    keyConceptsAr: [
      "الدعم كأرضية طلب",
      "المقاومة كسقف بيع",
      "قوة التفاعل حول المستويات",
      "دمج المستويات مع النماذج الانعكاسية",
    ],
    practicalExamples: [
      "Reading price bounce at support",
      "Watching rejection around resistance",
      "Using reversal patterns at key levels",
    ],
    practicalExamplesAr: [
      "قراءة ارتداد السعر من الدعم",
      "مراقبة الرفض عند المقاومة",
      "استخدام النماذج الانعكاسية عند المستويات المهمة",
    ],
    beginnerMistakes: [
      "Drawing too many levels on one chart",
      "Treating levels as exact single lines",
      "Ignoring the quality of reaction at the zone",
    ],
    beginnerMistakesAr: [
      "رسم عدد مبالغ فيه من المستويات على الشارت",
      "اعتبار المستوى خطاً دقيقاً فقط",
      "تجاهل جودة التفاعل داخل المنطقة",
    ],
    workbookIntro:
      "Use the workbook to mark support and resistance levels, then note how price reacts and whether the reaction is strong enough to matter.",
    workbookIntroAr:
      "استخدم الكراسة لتحديد مستويات الدعم والمقاومة ثم سجّل كيف تفاعل السعر وهل كان التفاعل قوياً بما يكفي أم لا.",
    quizContext:
      "The quiz checks whether you understand levels as reaction zones and not as magical reversal points.",
    quizContextAr:
      "الاختبار هنا يتأكد من فهمك للمستويات كمناطق تفاعل وليس كنقاط سحرية للانعكاس.",
    visuals: [
      { src: "/images/course-materials/image48.png", title: "Support and Resistance Levels", titleAr: "مستويات الدعم والمقاومة" },
      { src: "/images/course-materials/image49.png", title: "Level Mapping", titleAr: "تحديد المستويات" },
      { src: "/images/course-materials/image50.png", title: "Support Level Example", titleAr: "مثال على مستوى الدعم" },
      { src: "/images/course-materials/image52.png", title: "Reversal Pattern at a Level", titleAr: "نموذج انعكاسي عند مستوى مهم" },
    ],
  },
  "chart-patterns-rsi-integration": {
    intro:
      "This module brings together the pattern library shown in the course deck and the RSI confirmation mentioned in the founder's lesson file.",
    introAr:
      "هذه الوحدة تجمع بين مكتبة النماذج الموضحة داخل الملف وبين تأكيد RSI المذكور في درس المؤسس.",
    keyConcepts: [
      "Reversal patterns such as double top, double bottom, and head and shoulders",
      "Continuation patterns such as flag and wedge behavior",
      "Using RSI as confirmation rather than a standalone system",
    ],
    keyConceptsAr: [
      "النماذج الانعكاسية مثل الدبل توب والدبل بوتوم والرأس والكتفين",
      "النماذج الاستمرارية مثل العلم والأوتاد",
      "استخدام RSI كأداة تأكيد وليس كنظام مستقل",
    ],
    practicalExamples: [
      "Double top and double bottom reactions",
      "Head and shoulders and inverted head and shoulders",
      "Rising wedge, falling wedge, and bullish flag continuation",
    ],
    practicalExamplesAr: [
      "تفاعل نموذج الدبل توب والدبل بوتوم",
      "الرأس والكتفين والرأس والكتفين المقلوب",
      "الوتد الصاعد والهابط والعلم الصاعد الاستمراري",
    ],
    beginnerMistakes: [
      "Trading the pattern before the structure confirms it",
      "Using RSI without chart context",
      "Confusing reversal patterns with continuation patterns",
    ],
    beginnerMistakesAr: [
      "تداول النموذج قبل تأكيد الهيكل",
      "استخدام RSI بدون سياق على الشارت",
      "الخلط بين النماذج الانعكاسية والاستمرارية",
    ],
    workbookIntro:
      "Use the workbook to compare pattern shape, breakout behavior, and whether RSI is confirming the idea or contradicting it.",
    workbookIntroAr:
      "استخدم الكراسة لمقارنة شكل النموذج وسلوك الكسر وهل RSI يؤكد الفكرة أم يعارضها.",
    quizContext:
      "The quiz is designed to check your pattern context and confirmation logic, not memorization alone.",
    quizContextAr:
      "الاختبار مصمم لقياس فهمك لسياق النموذج ومنطق التأكيد وليس مجرد الحفظ.",
    visuals: [
      { src: "/images/course-materials/image27.png", title: "Double Top Pattern", titleAr: "نموذج الدبل توب" },
      { src: "/images/course-materials/image30.png", title: "Double Bottom Pattern", titleAr: "نموذج الدبل بوتوم" },
      { src: "/images/course-materials/image32.png", title: "Head and Shoulders", titleAr: "الرأس والكتفين" },
      { src: "/images/course-materials/image34.png", title: "Inverted Head and Shoulders", titleAr: "الرأس والكتفين المقلوب" },
      { src: "/images/course-materials/image38.png", title: "Falling Wedge", titleAr: "الوتد الهابط" },
      { src: "/images/course-materials/image42.png", title: "Bullish Flag", titleAr: "العلم الصاعد" },
    ],
  },
  "full-strategy-time-frame-explained": {
    intro:
      "The final lesson is where the course stops being isolated topics and becomes one trading workflow: read the candles, understand the pattern, respect the level, confirm the trendline, then choose the right timeframe for execution.",
    introAr:
      "الدرس الأخير هو النقطة التي تتوقف فيها المواضيع عن كونها أجزاء منفصلة وتتحول إلى تدفق تداول كامل: اقرأ الشموع، افهم النموذج، احترم المستوى، أكّد بالترندلاين، ثم اختر الفريم المناسب للتنفيذ.",
    keyConcepts: [
      "Top-down timeframe logic",
      "Confluence between candles, patterns, levels, and trendline",
      "Execution with discipline instead of impulsive entry",
    ],
    keyConceptsAr: [
      "منطق الفريمات من الأعلى إلى الأسفل",
      "التقاء الشموع والنماذج والمستويات والترندلاين",
      "التنفيذ بانضباط بدلاً من الدخول الاندفاعي",
    ],
    practicalExamples: [
      "Using higher timeframe context before lower timeframe execution",
      "Filtering entries through multiple confirmations",
      "Building a repeatable checklist before taking the trade",
    ],
    practicalExamplesAr: [
      "استخدام سياق الفريم الأكبر قبل تنفيذ الفريم الأصغر",
      "تصفية الدخول عبر أكثر من تأكيد",
      "بناء قائمة تنفيذ متكررة قبل الدخول في الصفقة",
    ],
    beginnerMistakes: [
      "Jumping between timeframes without a plan",
      "Taking a pattern without level or candle confirmation",
      "Looking for profit before defining risk",
    ],
    beginnerMistakesAr: [
      "التنقل بين الفريمات بدون خطة",
      "أخذ النموذج بدون تأكيد من المستوى أو الشمعة",
      "البحث عن الربح قبل تحديد المخاطرة",
    ],
    workbookIntro:
      "Use the workbook here as your final checklist builder. This is where the full method should become a repeatable process.",
    workbookIntroAr:
      "استخدم الكراسة هنا لبناء قائمة تنفيذك النهائية. في هذا الدرس يجب أن تتحول المنهجية الكاملة إلى عملية قابلة للتكرار.",
    quizContext:
      "The final quiz checks whether you can think in sequence, not just recognize isolated topics.",
    quizContextAr:
      "الاختبار النهائي هنا يتأكد أنك تفكر بالتسلسل، وليس فقط أنك تعرف كل موضوع منفصلًا.",
    visuals: [
      { src: "/images/course-materials/image2.png", title: "Candles Foundation Reference", titleAr: "مرجع الشموع" },
      { src: "/images/course-materials/image48.png", title: "Support and Resistance Reference", titleAr: "مرجع الدعم والمقاومة" },
      { src: "/images/course-materials/image53.png", title: "Trendline Reference", titleAr: "مرجع الترندلاين" },
    ],
  },
};
