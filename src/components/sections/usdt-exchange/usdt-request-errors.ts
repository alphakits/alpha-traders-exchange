/** Client-owned wording for the bounded Buy Requests API error contract. */
const messages: Record<string, readonly [string, string]> = {
  UNAUTHENTICATED: ["Sign in again to continue with your request.", "سجّل الدخول مجددًا للمتابعة بطلبك."],
  ACCESS_DENIED: ["A verified adult exchange account is required.", "يلزم حساب تداول موثّق لشخص بالغ."],
  VERIFICATION_REQUIRED: ["Complete your account verification before continuing.", "أكمل توثيق حسابك قبل المتابعة."],
  EMAIL_VERIFICATION_REQUIRED: ["Verify your email address before continuing.", "وثّق عنوان بريدك الإلكتروني قبل المتابعة."],
  PHONE_VERIFICATION_REQUIRED: ["Verify your phone number before continuing.", "وثّق رقم هاتفك قبل المتابعة."],
  AGE_CONFIRMATION_REQUIRED: ["Confirm that you are 18 or older before continuing.", "أكّد أن عمرك 18 عامًا أو أكثر قبل المتابعة."],
  ACCOUNT_DISABLED: ["This account is disabled. Contact support for help.", "هذا الحساب معطّل. تواصل مع الدعم للمساعدة."],
  SESSION_TEMPORARILY_UNAVAILABLE: ["Your session could not be confirmed. Wait a moment, then reload the page.", "تعذر تأكيد جلستك. انتظر قليلًا ثم أعد تحميل الصفحة."],
  FEATURE_UNAVAILABLE: ["Buy Requests are unavailable right now. Please try again later.", "طلبات الشراء غير متاحة حاليًا. حاول مجددًا لاحقًا."],
  NOT_FOUND: ["This request or response is no longer available to your account. Refresh the list.", "لم يعد هذا الطلب أو الرد متاحًا لحسابك. حدّث القائمة."],
  ORIGIN_DENIED: ["Reload this page before continuing.", "أعد تحميل هذه الصفحة قبل المتابعة."],
  INVALID_INPUT: ["Check the amount, price, network and payment details.", "تحقق من الكمية والسعر والشبكة وتفاصيل الدفع."],
  BODY_TOO_LARGE: ["The request contains too much data. Check the fields and try again.", "يحتوي الطلب على بيانات أكثر من المسموح. راجع الحقول وحاول مجددًا."],
  RATE_LIMITED: ["Too many actions. Wait a moment before trying again.", "أُجريت محاولات كثيرة. انتظر قليلًا قبل المحاولة مجددًا."],
  OPEN_REQUEST_EXISTS: ["You already have an open request. Edit or cancel it before publishing another.", "لديك طلب مفتوح بالفعل. عدّله أو ألغِه قبل نشر طلب آخر."],
  REQUEST_COOLDOWN: ["Wait five minutes between publications. You can still edit your open request.", "انتظر خمس دقائق بين عمليتي نشر. لا يزال بإمكانك تعديل طلبك المفتوح."],
  DAILY_LIMIT: ["You can publish two requests in any 24 hours. Editing an open request does not use a slot.", "يمكنك نشر طلبين خلال أي 24 ساعة. تعديل الطلب المفتوح لا يستخدم فرصة نشر."],
  IDEMPOTENCY_CONFLICT: ["This submission no longer matches the saved request. Refresh and review the details.", "لم تعد هذه المحاولة تطابق الطلب المحفوظ. حدّث الصفحة وراجع التفاصيل."],
  REQUEST_CHANGED: ["This request changed or closed. Refresh and review its current details.", "تغيّر هذا الطلب أو أُغلق. حدّث الصفحة وراجع تفاصيله الحالية."],
  TRADE_EXISTS: ["This accepted request is locked. Continue in its Trade Room.", "هذا الطلب المقبول مقفل. تابع في غرفة الصفقة الخاصة به."],
  QUOTE_UNAVAILABLE: ["A fresh price reference is required. Refresh before continuing.", "يلزم مرجع سعر حديث. حدّث السعر قبل المتابعة."],
  PRICE_OUTSIDE_BAND: ["The price is outside the current allowed range. Refresh the reference and review the price.", "السعر خارج النطاق المسموح حاليًا. حدّث السعر المرجعي وراجع سعرك."],
  AMOUNT_INVALID: ["The payment total must be at least ₪0.01.", "يجب ألا يقل إجمالي الدفع عن ₪0.01."],
  ATM_AMOUNT_INVALID: ["The total including the buyer fee must be a supported ATM cash amount in ₪100 steps.", "يجب أن يكون الإجمالي شاملًا رسوم المشتري مبلغ سحب مدعومًا بمضاعفات ₪100."],
  RESPONSE_COOLDOWN: ["Wait one minute before sending another response.", "انتظر دقيقة واحدة قبل إرسال رد آخر."],
  RESPONSE_LIMIT: ["This request has reached its response limit. Browse other open requests.", "وصل هذا الطلب إلى الحد الأقصى للردود. تصفح الطلبات المفتوحة الأخرى."],
  CURSOR_INVALID: ["This page of requests changed. Refresh the list.", "تغيّرت صفحة الطلبات هذه. حدّث القائمة."],
  LISTING_UNAVAILABLE: ["Choose an approved, available listing that matches this request.", "اختر عرضًا معتمدًا ومتاحًا يطابق هذا الطلب."],
  SELLER_TRADE_LIMIT: ["The seller has reached the active-trade limit. Choose another response or try later.", "وصل البائع إلى حد الصفقات النشطة. اختر ردًا آخر أو حاول لاحقًا."],
  AMOUNT_UNAVAILABLE: ["The full amount no longer fits this listing's available stock or trade limits.", "لم تعد الكمية الكاملة ضمن الرصيد المتاح أو حدود التداول لهذا العرض."],
  INVALID_DEMAND_MATCH: ["Refresh the request and select a current seller response.", "حدّث الطلب واختر ردًا حاليًا من البائع."],
  OFFER_CHANGED: ["This response is no longer available. Refresh and choose a current response.", "لم يعد هذا الرد متاحًا. حدّث الصفحة واختر ردًا حاليًا."],
  TERMS_CHANGED: ["Review the current amount, price, payment method and network before continuing.", "راجع الكمية والسعر وطريقة الدفع والشبكة الحالية قبل المتابعة."],
  LISTING_CHANGED: ["The seller changed this listing. Ask for an updated response.", "غيّر البائع هذا العرض. اطلب ردًا محدثًا."],
  ACTIVE_TRADE_EXISTS: ["Finish your active trade before opening another one.", "أكمل صفقتك النشطة قبل فتح صفقة أخرى."],
  PENDING_BUYER_FEEDBACK: ["Complete the required feedback for your previous trade before continuing.", "أكمل التقييم المطلوب لصفقتك السابقة قبل المتابعة."],
  SELLER_COMMISSION_DUE: ["Outstanding seller fees must be settled before continuing.", "يجب تسوية رسوم البائع المستحقة قبل المتابعة."],
};

export class RequestClientError extends Error {
  constructor(readonly code: string) {
    super("Buy Requests action could not be confirmed.");
    this.name = "RequestClientError";
  }
}

export function requestErrorMessage(error: unknown, ar: boolean): string {
  if (error instanceof RequestClientError && Object.hasOwn(messages, error.code)) return messages[error.code][ar ? 1 : 0];
  // Never show arbitrary server text, stack traces, or transport messages.
  return ar ? "تعذر تأكيد النتيجة. حدّث الطلب وراجع حالته قبل المحاولة مجددًا." : "Could not confirm the result. Refresh the request and check its status before trying again.";
}
