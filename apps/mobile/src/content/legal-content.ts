export type NativeLegalSection = {
  title: string;
  paragraphs: string[];
};

export const privacyContent = {
  en: {
    title: "Privacy Policy",
    intro: "This policy explains information Alpha Traders may process when you use the website, academy, or Alpha Exchange, why it is needed, and how it is handled.",
    requestLabel: "Privacy requests",
    sections: [
      { title: "Information we may collect", paragraphs: ["Depending on how you use the service, data may include account and contact details, authentication and verification records, profile information, marketplace listings, trade messages and status history, payment or wallet details needed for a trade, uploaded evidence, support reports, notification preferences, and technical security logs."] },
      { title: "How information is used", paragraphs: ["We process information to provide accounts and marketplace features, coordinate trades, display appropriate public seller signals, deliver notifications, investigate disputes and abuse, secure the platform, enforce rules, maintain records, improve reliability, and meet applicable legal obligations."] },
      { title: "Trade-stage disclosure", paragraphs: ["Sensitive trade information is disclosed according to the trade stage and participant role. Only submit information needed for the transaction. Do not place identity documents, bank details, payment evidence, passwords, recovery codes, or wallet secrets in public profiles, Discord, social channels, or unsolicited private messages."] },
      { title: "Service providers and legal disclosure", paragraphs: ["Information may be shared with vendors that help operate hosting, authentication, messaging, security, storage, or support, subject to their service role. We may also preserve or disclose information when reasonably necessary to investigate abuse, protect users or the service, enforce terms, respond to lawful requests, or meet applicable law. We do not treat private identity documents as public business proof."] },
      { title: "Retention and security", paragraphs: ["We use reasonable technical and organizational measures intended to protect information. No internet service or storage system can guarantee absolute security. Records are retained only as reasonably needed for operations, security, disputes, enforcement, and applicable legal requirements, after which they may be deleted or de-identified."] },
      { title: "Your choices and requests", paragraphs: ["You can update available account and notification settings. Use the dedicated Account Deletion page to request deletion, or contact support to request access, correction, or export of personal information. Some information may need to be retained where reasonably required for security, disputes, fraud prevention, record integrity, or law. We may need to verify the requester before acting."] },
      { title: "Cookies and similar technology", paragraphs: ["The service may use cookies or local storage for authentication, security, preferences, language, and essential functionality. See the Cookies page for additional information."] },
    ] satisfies NativeLegalSection[],
  },
  ar: {
    title: "سياسة الخصوصية",
    intro: "تشرح هذه السياسة المعلومات التي قد تعالجها Alpha Traders عند استخدام الموقع أو الأكاديمية أو Alpha Exchange، ولماذا نحتاج إليها وكيف نتعامل معها.",
    requestLabel: "طلبات الخصوصية",
    sections: [
      { title: "المعلومات التي قد نجمعها", paragraphs: ["بحسب استخدامك للخدمة، قد تشمل البيانات معلومات الحساب والتواصل، وسجلات المصادقة والتحقق، ومعلومات الملف، وعروض السوق، ورسائل الصفقة وسجل حالتها، وتفاصيل الدفع أو المحفظة اللازمة للصفقة، والأدلة المرفوعة، وبلاغات الدعم، وتفضيلات الإشعارات، وسجلات الأمان التقنية."] },
      { title: "كيف نستخدم المعلومات", paragraphs: ["نعالج المعلومات لتقديم الحساب وميزات السوق، وتنسيق الصفقات، وإظهار إشارات البائع العامة المناسبة، وإرسال الإشعارات، والتحقيق في النزاعات والإساءة، وحماية المنصة، وتطبيق القواعد، وحفظ السجلات، وتحسين الاعتمادية، والوفاء بالمتطلبات القانونية المعمول بها."] },
      { title: "إظهار البيانات حسب مرحلة الصفقة", paragraphs: ["تظهر معلومات الصفقة الحساسة حسب مرحلتها ودور المشارك. أرسل فقط المعلومات اللازمة للمعاملة. لا تضع وثائق الهوية أو تفاصيل البنك أو أدلة الدفع أو كلمات المرور أو رموز الاسترداد أو أسرار المحفظة في ملف عام أو Discord أو قنوات التواصل أو رسالة خاصة غير مطلوبة."] },
      { title: "مزودو الخدمة والإفصاح القانوني", paragraphs: ["قد نشارك المعلومات مع مزودين يساعدون في الاستضافة أو المصادقة أو المراسلة أو الأمان أو التخزين أو الدعم وفق دورهم في الخدمة. وقد نحفظ المعلومات أو نكشفها عند الحاجة المعقولة للتحقيق في إساءة أو حماية المستخدمين أو الخدمة أو تطبيق الشروط أو الاستجابة لطلب قانوني أو الوفاء بالقانون. لا نعامل وثائق الهوية الخاصة كدليل تجاري عام."] },
      { title: "الاحتفاظ والأمان", paragraphs: ["نستخدم إجراءات تقنية وتنظيمية معقولة لحماية المعلومات. لا يمكن لأي خدمة إنترنت أو نظام تخزين ضمان الأمان المطلق. نحتفظ بالسجلات بقدر الحاجة المعقولة للتشغيل والأمان والنزاعات وتطبيق القواعد والمتطلبات القانونية، ثم قد نحذفها أو نزيل ارتباطها بالهوية."] },
      { title: "خياراتك وطلباتك", paragraphs: ["يمكنك تحديث إعدادات الحساب والإشعارات المتاحة. استخدم صفحة حذف الحساب المخصصة لطلب الحذف، أو تواصل مع الدعم لطلب الوصول إلى معلوماتك الشخصية أو تصحيحها أو تصديرها. قد نحتاج للاحتفاظ ببعض المعلومات لأسباب تتعلق بالأمان أو النزاعات أو منع الاحتيال أو سلامة السجلات أو القانون، وقد نتحقق من هوية مقدم الطلب أولًا."] },
      { title: "الكوكيز والتقنيات المشابهة", paragraphs: ["قد تستخدم الخدمة الكوكيز أو التخزين المحلي للمصادقة والأمان والتفضيلات واللغة والوظائف الأساسية. راجع صفحة الكوكيز لمعلومات إضافية."] },
    ] satisfies NativeLegalSection[],
  },
} as const;

export const termsContent = {
  en: {
    title: "Terms of Service",
    intro: "By using Alpha Traders or Alpha Exchange, you agree to these terms and the platform rules shown while using the service.",
    requestLabel: "Terms questions",
    sections: [
      { title: "1. Platform role and direct settlement", paragraphs: ["Alpha Traders provides trading education and a structured peer-to-peer workflow for USDT listings and trade requests. The platform coordinates trade stages, records activity and evidence, and provides support and dispute tools.", "For marketplace trades, Alpha Traders does not take custody of the principal funds. Buyers send the agreed payment directly to sellers, and sellers transfer USDT directly to the buyer's confirmed wallet and network. The workflow is not custodial escrow."] },
      { title: "2. Marketplace rules and user responsibility", paragraphs: ["Users must provide accurate information, use only payment methods and wallets they are authorized to use, verify the amount, recipient, network, address, and transaction status, and keep required communication and evidence inside the official Trade Room.", "Users accept the risks of peer-to-peer payment, counterparties, payment reversals, wallet mistakes, network fees, blockchain delays, and digital assets. No trade, price, outcome, or profit is guaranteed."] },
      { title: "3. Seller approval", paragraphs: ["Only sellers approved by Alpha Traders may publish listings. Applications are reviewed manually, and additional information may be requested. Approval is a revocable platform access decision; it is not a guarantee of identity, future conduct, solvency, profit, or a risk-free transaction."] },
      { title: "4. Fees and listing access", paragraphs: ["The current platform commission is 1% of completed marketplace trades unless a different fee is clearly shown before the relevant action. Sellers may be prevented from publishing or renewing listings while commission payments are pending. Fees and fee rules may change prospectively after notice on the website."] },
      { title: "5. Evidence, disputes, and enforcement", paragraphs: ["Users must preserve accurate payment and transfer evidence. Alpha Traders may review trade records, request additional information, pause actions, restrict listings, suspend accounts, or take other reasonable platform measures when investigating a dispute, suspected fraud, abuse, or a rule violation.", "Support and dispute review can help assess platform records but cannot reverse an external bank transfer or blockchain transaction and does not guarantee recovery."] },
      { title: "6. Prohibited conduct", paragraphs: ["Users may not impersonate another person, submit false evidence, manipulate reviews or reputation signals, evade restrictions or fees, misuse another person's payment method or account, threaten or harass others, distribute secrets or personal data, or use the service for unlawful activity."] },
      { title: "7. Education and financial decisions", paragraphs: ["Academy material is general educational information. It is not personalized investment, financial, legal, accounting, or tax advice. Users remain responsible for their own decisions and should seek qualified independent advice where appropriate."] },
      { title: "8. Availability and changes", paragraphs: ["Features may be unavailable, delayed, corrected, restricted, or changed for maintenance, security, operational, or legal reasons. Alpha Traders may update these terms prospectively; the reviewed date below identifies the published version."] },
      { title: "Suspicious-activity review (AML)", paragraphs: ["Alpha Traders may review suspected activity, request information, restrict platform use, preserve records, or make reports when required by applicable law. This section is not a claim that Alpha Traders holds a particular financial-services licence."] },
      { title: "Verification information (KYC)", paragraphs: ["Users may be asked for additional verification information for security, dispute, platform-risk, or legal reasons. Sensitive documents should be submitted only through an official channel requested by Alpha Traders and must not be posted in public profiles or community channels."] },
      { title: "Compliance with law", paragraphs: ["Users are responsible for ensuring their use of the service, payment methods, wallets, and digital assets is permitted where they are located. Alpha Traders may restrict features when reasonably required for legal, security, or operational reasons."] },
    ] satisfies NativeLegalSection[],
  },
  ar: {
    title: "الشروط والأحكام",
    intro: "باستخدام Alpha Traders أو Alpha Exchange، فإنك توافق على هذه الشروط وسياسات المنصة المعروضة أثناء استخدام الخدمة.",
    requestLabel: "أسئلة الشروط",
    sections: [
      { title: "1. دور المنصة والتسوية المباشرة", paragraphs: ["تقدم Alpha Traders تعليم التداول ومسارًا منظمًا نظيرًا إلى نظير لعروض USDT وطلبات الصفقات. تنسق المنصة مراحل الصفقة وتسجل النشاط والأدلة وتوفر أدوات للدعم والنزاعات.", "لا تحتفظ Alpha Traders بأصل أموال صفقات السوق. يرسل المشتري الدفعة المتفق عليها مباشرة إلى البائع، ويرسل البائع USDT مباشرة إلى محفظة المشتري وشبكته المؤكدتين. هذا المسار ليس إسكرو احتجازيًا."] },
      { title: "2. قواعد السوق ومسؤولية المستخدم", paragraphs: ["يجب على المستخدم تقديم معلومات دقيقة، واستخدام وسائل دفع ومحافظ يملك صلاحية استخدامها، والتحقق من المبلغ والمستلم والشبكة والعنوان وحالة المعاملة، والاحتفاظ بالتواصل والأدلة المطلوبة داخل غرفة التداول الرسمية.", "يتحمل المستخدم مخاطر الدفع نظيرًا إلى نظير والطرف المقابل وعكس الدفعات وأخطاء المحفظة ورسوم الشبكة وتأخير البلوكشين والأصول الرقمية. لا توجد صفقة أو نتيجة أو ربح مضمون."] },
      { title: "3. اعتماد البائع", paragraphs: ["يمكن فقط للبائعين الذين وافقت عليهم Alpha Traders نشر العروض. تُراجع الطلبات يدويًا وقد تُطلب معلومات إضافية. الاعتماد صلاحية استخدام قابلة للسحب، وليس ضمانًا للهوية أو السلوك المستقبلي أو الملاءة أو الربح أو صفقة بلا مخاطر."] },
      { title: "4. العمولات وصلاحية نشر العروض", paragraphs: ["العمولة الحالية للمنصة هي 1% من صفقات السوق المكتملة ما لم تظهر عمولة مختلفة بوضوح قبل الإجراء المعني. قد يُمنع البائع من نشر العروض أو تجديدها أثناء وجود عمولات معلقة. يمكن تعديل العمولات وقواعدها مستقبلًا بعد إشعار على الموقع."] },
      { title: "5. الأدلة والنزاعات والإجراءات", paragraphs: ["يجب الاحتفاظ بأدلة دقيقة للدفع والتحويل. يمكن لـ Alpha Traders مراجعة سجلات الصفقة وطلب معلومات إضافية وإيقاف إجراءات أو تقييد العروض أو تعليق الحسابات أو اتخاذ إجراءات معقولة عند التحقيق في نزاع أو احتيال مشتبه أو إساءة أو مخالفة للقواعد.", "قد تساعد مراجعة الدعم والنزاعات في تقييم سجلات المنصة، لكنها لا تستطيع عكس تحويل بنكي خارجي أو معاملة بلوكشين ولا تضمن استرداد الأموال."] },
      { title: "6. السلوك المحظور", paragraphs: ["لا يجوز انتحال شخصية الغير أو تقديم أدلة مزيفة أو التلاعب بالمراجعات أو إشارات السمعة أو تجاوز القيود أو العمولات أو إساءة استخدام وسيلة دفع أو حساب لشخص آخر أو التهديد أو المضايقة أو نشر الأسرار أو البيانات الشخصية أو استخدام الخدمة في نشاط غير قانوني."] },
      { title: "7. التعليم والقرارات المالية", paragraphs: ["محتوى الأكاديمية معلومات تعليمية عامة، وليس نصيحة استثمارية أو مالية أو قانونية أو محاسبية أو ضريبية شخصية. يبقى المستخدم مسؤولًا عن قراراته وعليه طلب مشورة مستقلة مؤهلة عند الحاجة."] },
      { title: "8. التوفر والتعديلات", paragraphs: ["قد تتوقف الميزات أو تتأخر أو تُصحح أو تُقيد أو تتغير لأسباب تتعلق بالصيانة أو الأمان أو التشغيل أو القانون. يمكن لـ Alpha Traders تحديث هذه الشروط مستقبلًا، ويحدد تاريخ المراجعة أدناه النسخة المنشورة."] },
      { title: "مراجعة النشاط المشبوه (AML)", paragraphs: ["قد تراجع Alpha Traders النشاط المشتبه به، وتطلب معلومات، وتقيد استخدام المنصة، وتحفظ السجلات أو تقدم البلاغات عندما يتطلب القانون المعمول به ذلك. لا يمثل هذا القسم ادعاءً بوجود ترخيص مالي محدد."] },
      { title: "معلومات التحقق (KYC)", paragraphs: ["قد يُطلب من المستخدم معلومات تحقق إضافية لأسباب تتعلق بالأمان أو النزاعات أو مخاطر المنصة أو القانون. يجب تقديم الوثائق الحساسة فقط من خلال قناة رسمية تطلبها Alpha Traders، ولا يجوز نشرها في الملفات العامة أو قنوات المجتمع."] },
      { title: "الامتثال للقانون", paragraphs: ["يتحمل المستخدم مسؤولية التأكد من أن استخدامه للخدمة وطرق الدفع والمحافظ والأصول الرقمية مسموح في مكانه. قد تُقيد Alpha Traders ميزات عندما يكون ذلك مطلوبًا لأسباب قانونية أو أمنية أو تشغيلية."] },
    ] satisfies NativeLegalSection[],
  },
} as const;

export const cookiesContent = {
  en: {
    title: "Cookies",
    intro: "Alpha Traders uses cookies and device storage only where needed to keep the website and app secure, remember your choices, and operate core features.",
    requestLabel: "Cookie questions",
    sections: [
      { title: "Essential storage", paragraphs: ["Authentication tokens, security state, language choice, and other essential preferences may be stored so the service can keep you signed in and protect your session. Disabling essential storage may prevent account, marketplace, or academy features from working."] },
      { title: "Security and reliability", paragraphs: ["Technical identifiers may be used to detect abuse, apply rate limits, recover sessions, diagnose failures, and keep trade actions consistent. The native app stores sensitive session material in the operating system's protected secure storage."] },
      { title: "Analytics and preferences", paragraphs: ["Where optional measurement is used, it is intended to understand aggregate service performance and improve the experience. Alpha Traders does not use essential authentication storage for advertising."] },
      { title: "Your control", paragraphs: ["You can clear website cookies in your browser and remove app data through your device settings. Clearing stored data signs you out and resets local preferences. Contact support if you need help with a privacy or storage request."] },
    ] satisfies NativeLegalSection[],
  },
  ar: {
    title: "الكوكيز",
    intro: "تستخدم Alpha Traders الكوكيز وتخزين الجهاز فقط عند الحاجة لحماية الموقع والتطبيق وتذكر اختياراتك وتشغيل الميزات الأساسية.",
    requestLabel: "أسئلة الكوكيز",
    sections: [
      { title: "التخزين الأساسي", paragraphs: ["قد تُحفظ رموز المصادقة وحالة الأمان واختيار اللغة والتفضيلات الأساسية حتى تبقى الجلسة فعالة ومحمية. قد يؤدي تعطيل التخزين الأساسي إلى توقف ميزات الحساب أو السوق أو الأكاديمية."] },
      { title: "الأمان والاعتمادية", paragraphs: ["قد تُستخدم المعرّفات التقنية لاكتشاف الإساءة وتطبيق حدود الطلبات واستعادة الجلسة وتشخيص الأعطال والحفاظ على اتساق إجراءات الصفقة. يحفظ التطبيق الأصلي بيانات الجلسة الحساسة في التخزين الآمن المحمي بنظام التشغيل."] },
      { title: "التحليلات والتفضيلات", paragraphs: ["عند استخدام قياس اختياري، يهدف إلى فهم أداء الخدمة إجمالًا وتحسين التجربة. لا تستخدم Alpha Traders تخزين المصادقة الأساسي للإعلانات."] },
      { title: "خياراتك", paragraphs: ["يمكنك مسح كوكيز الموقع من المتصفح وحذف بيانات التطبيق من إعدادات جهازك. يؤدي مسح البيانات إلى تسجيل الخروج وإعادة ضبط التفضيلات المحلية. تواصل مع الدعم للمساعدة في طلب يتعلق بالخصوصية أو التخزين."] },
    ] satisfies NativeLegalSection[],
  },
} as const;
