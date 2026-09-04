import type { AppLocale } from "@/i18n/routing";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification } from "@/types/alpha-exchange";

const ARABIC_TITLE_BY_ENGLISH: Record<string, string> = {
  "listing expired": "انتهت صلاحية العرض",
  "congratulations on your new seller rank": "تهانينا على رتبة البائع الجديدة",
  "commission overdue": "عمولة متأخرة",
  "commission payment required": "مطلوب دفع العمولة",
  "action required on your trade": "مطلوب إجراء في صفقتك",
  "buyer inactivity warning sent": "تم إرسال تنبيه لعدم نشاط المشتري",
  "action required: trade still waiting": "مطلوب إجراء: الصفقة ما زالت معلقة",
  "trade update: buyer reminder sent": "تحديث الصفقة: تم تذكير المشتري",
  "trade overdue": "الصفقة متأخرة",
  "usdt release overdue": "تأخر إرسال USDT",
  "trade overdue alert": "تنبيه بتأخر الصفقة",
  "trust score increased": "ارتفعت درجة الثقة",
  "prestige rank updated": "تم تحديث رتبة البائع",
  "prestige override removed": "تمت إزالة التعديل الإداري للرتبة",
  "prestige rank updated by admin": "حدّثت الإدارة رتبة البائع",
  "congratulations! new prestige rank unlocked": "تهانينا! تم فتح رتبة جديدة",
  "prestige promotion unlocked": "تم فتح ترقية جديدة",
  "new approved seller application": "طلب بائع معتمد جديد",
  "seller application submitted": "تم إرسال طلب البائع",
  "seller application needs review": "طلب بائع يحتاج إلى مراجعة",
  "seller application approved": "تمت الموافقة على طلب البائع",
  "application approved": "تمت الموافقة على الطلب",
  "seller application rejected": "تم رفض طلب البائع",
  "application rejected": "تم رفض الطلب",
  "marketplace compliance restriction issued": "تم فرض تقييد امتثال في السوق",
  "payment submitted": "تم إرسال الدفعة",
  "compliance appeal decision": "صدر قرار بشأن استئناف الامتثال",
  "marketplace compliance restriction cleared": "تمت تسوية تقييد الامتثال في السوق",
  "marketplace compliance restriction removed": "تمت إزالة تقييد الامتثال في السوق",
  "seller privileges revoked": "تم إلغاء صلاحيات البائع",
  "seller marketplace privileges revoked": "تم إلغاء صلاحيات البائع في السوق",
  "new listing pending review": "عرض جديد بانتظار المراجعة",
  "listing submitted": "تم إرسال العرض",
  "listing submitted for review": "تم إرسال العرض للمراجعة",
  "listing approval required": "العرض يحتاج إلى موافقة",
  "listing changes need review": "تعديلات العرض تحتاج إلى مراجعة",
  "listing resubmitted for review": "تمت إعادة إرسال العرض للمراجعة",
  "listing renewed": "تم تجديد العرض",
  "listing approved": "تمت الموافقة على العرض",
  "listing rejected": "تم رفض العرض",
  "listing needs changes": "العرض يحتاج إلى تعديلات",
  "listing changes requested": "طُلبت تعديلات على العرض",
  "listing closed": "تم إغلاق العرض",
  "vacation enabled": "تم تفعيل وضع الإجازة",
  "vacation disabled": "تم إلغاء وضع الإجازة",
  "availability updated": "تم تحديث حالة التوفر",
  "seller entered vacation mode": "دخل البائع في وضع الإجازة",
  "trade cancelled": "تم إلغاء الصفقة",
  "listing expiration extended": "تم تمديد صلاحية العرض",
  "listing force closed": "تم إغلاق العرض إدارياً",
  "🟢 new usdt listing available": "🟢 عرض USDT جديد متاح",
  "listing unavailable": "العرض غير متاح",
  "new trade request": "طلب صفقة جديد",
  "new price offer": "عرض سعر جديد",
  "new price offer submitted": "تم إرسال عرض سعر جديد",
  "price offer submitted": "تم إرسال عرض السعر",
  "new trade request submitted": "تم إرسال طلب صفقة جديد",
  "trade request submitted": "تم إرسال طلب الصفقة",
  "feedback required": "مطلوب تقييم",
  "action required": "مطلوب إجراء",
  "trade closed": "تم إغلاق الصفقة",
  "new trade room message": "رسالة جديدة في غرفة التداول",
  "trade room reminder": "تذكير من غرفة التداول",
  "withdrawal ready": "السحب جاهز",
  "buyer marked payment sent": "أكد المشتري إرسال الدفعة",
  "seller confirmed cash collected": "أكد البائع استلام النقد",
  "seller confirmed funds received": "أكد البائع استلام الأموال",
  "seller marked usdt sent": "أكد البائع إرسال USDT",
  "trade evidence uploaded": "تم رفع إثبات للصفقة",
  "buyer left a review": "أضاف المشتري تقييماً",
  "review submitted": "تم إرسال التقييم",
  "seller replied to your review": "رد البائع على تقييمك",
  "review response sent": "تم إرسال الرد على التقييم",
  "trade request accepted": "تم قبول طلب الصفقة",
  "price offer accepted": "تم قبول عرض السعر",
  "price offer declined": "تم رفض عرض السعر",
  "usdt release pending": "إرسال USDT قيد الانتظار",
  "trade completed": "اكتملت الصفقة",
  "review available": "التقييم متاح الآن",
  "large-value trade completed": "اكتملت صفقة ذات قيمة كبيرة",
  "commission payment verified": "تم التحقق من دفع العمولة",
  "commission payment received": "تم استلام دفع العمولة",
  "commission marked paid": "تم تسجيل العمولة كمدفوعة",
  "new marketplace feedback submitted": "تم إرسال تقييم جديد للسوق",
  "marketplace feedback submitted": "تم إرسال تقييم السوق",
  "notification preferences updated": "تم تحديث تفضيلات الإشعارات",
  "dispute opened": "تم فتح نزاع",
  "multiple buyer reports detected": "تم رصد عدة بلاغات من المشترين",
  "seller reported": "تم الإبلاغ عن البائع",
};

const ARABIC_ACTION_BY_ENGLISH: Record<string, string> = {
  "open seller listings": "فتح عروض البائع",
  "view seller insights": "عرض إحصاءات البائع",
  "manage listing": "إدارة العرض",
  "review listing": "مراجعة العرض",
  "pay commission": "دفع العمولة",
  "review commission": "مراجعة العمولة",
  "open trade room": "فتح غرفة التداول",
  "review trade": "مراجعة الصفقة",
  "view trade": "عرض الصفقة",
  "review seller": "مراجعة البائع",
  "review application": "مراجعة الطلب",
  "review marketplace compliance": "مراجعة امتثال السوق",
  "monitor request": "متابعة الطلب",
  "leave feedback": "إضافة تقييم",
  "monitor trade": "متابعة الصفقة",
  "verify payment": "التحقق من الدفع",
  "confirm completion": "تأكيد الإكمال",
  "leave review": "إضافة تقييم",
  "continue trade": "متابعة الصفقة",
  "accept or decline this request": "قبول الطلب أو رفضه",
  "accept or decline this price offer": "قبول عرض السعر أو رفضه",
  "wait for seller response": "انتظار رد البائع",
  "wait for seller response to your price offer": "انتظار رد البائع على عرض سعرك",
  "wait for buyer payment proof": "انتظار إثبات دفع المشتري",
  "upload payment proof and mark payment sent": "رفع إثبات الدفع وتأكيد الإرسال",
  "verify payment, upload proof, then mark usdt sent": "التحقق من الدفع ورفع الإثبات ثم تأكيد إرسال USDT",
  "wait for seller usdt release": "انتظار إرسال USDT من البائع",
  "wait for buyer completion confirmation": "انتظار تأكيد المشتري لإكمال الصفقة",
  "confirm trade completed": "تأكيد اكتمال الصفقة",
  "leave your trade review": "إضافة تقييمك للصفقة",
  "trade is closed": "الصفقة مغلقة",
  "open trade details": "فتح تفاصيل الصفقة",
  "view details": "عرض التفاصيل",
  open: "فتح",
};

const ARABIC_MESSAGE_BY_ENGLISH: Record<string, string> = {
  "your seller account is approved and now active.": "تمت الموافقة على حساب البائع الخاص بك، وهو نشط الآن.",
  "your seller application was rejected.": "تم رفض طلبك للانضمام كبائع.",
  "your marketplace recovery fee payment was submitted and is awaiting owner verification.":
    "تم إرسال دفعة رسوم استعادة السوق، وهي بانتظار تحقق المالك.",
  "your compliance appeal was accepted.": "تم قبول استئناف الامتثال الخاص بك.",
  "your compliance appeal was reviewed and rejected.": "تمت مراجعة استئناف الامتثال الخاص بك ورفضه.",
  "your marketplace recovery fee was confirmed and the compliance restriction is now cleared. listing and publishing permissions are restored.":
    "تم تأكيد رسوم استعادة السوق ورفع تقييد الامتثال. استُعيدت صلاحيات إنشاء العروض ونشرها.",
  "your marketplace compliance restriction was removed by owner review. listing and publishing permissions are restored.":
    "أزال المالك تقييد الامتثال بعد المراجعة. استُعيدت صلاحيات إنشاء العروض ونشرها.",
  "your seller marketplace privileges were permanently revoked after repeated policy violations. existing active trades remain available for completion.":
    "أُلغيت صلاحياتك كبائع في السوق نهائيًا بعد مخالفات متكررة للسياسات. تبقى صفقاتك النشطة متاحة لإكمالها.",
  "your listings are now hidden from buyers until you switch back to available or away.":
    "عروضك مخفية الآن عن المشترين حتى تغيّر حالتك إلى متاح أو بعيد.",
  "your seller availability is now set to away.": "تم ضبط حالة توفرك كبائع على بعيد.",
  "your listings are visible to buyers again.": "أصبحت عروضك ظاهرة للمشترين من جديد.",
  "your listing has been approved and is now live in the marketplace.": "تمت الموافقة على عرضك، وهو منشور الآن في السوق.",
  "you have a new message in your active alpha exchange trade.": "لديك رسالة جديدة في صفقتك النشطة على Alpha Exchange.",
  "your buyer is waiting for you in an active trade.": "المشتري بانتظارك في صفقة نشطة.",
  "your seller is waiting for you in an active trade.": "البائع بانتظارك في صفقة نشطة.",
  "buyer marked payment as sent. please verify the funds in your bank account.":
    "أكد المشتري إرسال الدفعة. تحقّق من وصول الأموال إلى حسابك البنكي.",
  "buyer has prepared the cardless withdrawal. confirm after collecting the cash.":
    "جهّز المشتري السحب دون بطاقة. أكّد العملية بعد استلام النقد.",
  "buyer marked payment as sent. confirm funds in person after following safety guidelines.":
    "أكد المشتري إرسال الدفعة. أكّد استلام الأموال وجهًا لوجه بعد اتباع إرشادات الأمان.",
  "seller marked usdt as sent. please confirm receipt to complete the trade.":
    "أكد البائع إرسال USDT. أكّد الاستلام لإكمال الصفقة.",
  "a buyer submitted a review for a completed trade.": "أرسل أحد المشترين تقييمًا لصفقة مكتملة.",
  "the seller responded to your completed trade review.": "ردّ البائع على تقييمك للصفقة المكتملة.",
  "your meeting is ready. review the safety guidelines before meeting.":
    "تم تجهيز موعد اللقاء. راجع إرشادات الأمان قبل المقابلة.",
  "seller accepted your trade request. you can now upload your payment receipt.":
    "قبل البائع طلب الصفقة. يمكنك الآن رفع إيصال الدفع.",
  "your trade request was declined by the seller.": "رفض البائع طلب الصفقة الخاص بك.",
  "the buyer cancelled this trade request.": "ألغى المشتري طلب الصفقة هذا.",
  "seller verified the bank transfer and confirmed funds received.":
    "تحقّق البائع من التحويل البنكي وأكد استلام الأموال.",
  "seller confirmed cash was collected from the cardless atm.": "أكد البائع استلام النقد من الصراف الآلي دون بطاقة.",
  "seller confirmed in-person payment was received.": "أكد البائع استلام الدفعة وجهًا لوجه.",
  "seller started the usdt release process. the 45-minute window has begun.":
    "بدأ البائع عملية إرسال USDT. بدأت مهلة الـ 45 دقيقة.",
  "your trade is complete and has been moved to your trade history.": "اكتملت صفقتك ونُقلت إلى سجل الصفقات.",
  "you can now leave a rating and review for this trade.": "يمكنك الآن إضافة تقييم ومراجعة لهذه الصفقة.",
  "buyer confirmed receipt. the trade is complete. check your commission due.":
    "أكد المشتري الاستلام واكتملت الصفقة. تحقّق من العمولة المستحقة عليك.",
};

type NotificationMessageTemplate = {
  pattern: RegExp;
  translate: (captures: string[]) => string;
};

function arabicPaymentMethod(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bank transfer" || normalized === "bank transfer israel") return "تحويل بنكي";
  if (normalized === "face-to-face (meet in person)" || normalized === "face-to-face") return "دفع وجهًا لوجه";
  if (normalized === "cardless atm withdrawal" || normalized === "cardless atm") return "سحب من الصراف الآلي دون بطاقة";
  return value.trim();
}

function arabicFeedbackCategory(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bug") return "عن خلل";
  if (normalized === "suggestion") return "يتضمن اقتراحًا";
  if (normalized === "confusing_ux") return "عن تجربة استخدام غير واضحة";
  if (normalized === "feature_request") return "يتضمن طلب ميزة";
  if (normalized === "performance") return "عن الأداء";
  if (normalized === "other") return "ضمن فئة أخرى";
  return `ضمن فئة ${value.trim()}`;
}

function arabicSellerRank(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    bronze: "البرونزية",
    silver: "الفضية",
    gold: "الذهبية",
    diamond: "الماسية",
    elite: "النخبة",
    platinum: "البلاتينية",
    legendary: "الأسطورية",
  };
  return labels[normalized] ?? (containsArabicText(value) ? value.trim() : "غير معروفة");
}

function arabicPromotionBenefit(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "higher marketplace visibility and stronger buyer trust.") {
    return "ظهور أعلى في السوق وثقة أقوى لدى المشترين.";
  }
  if (normalized === "priority placement and stronger trust signaling on seller cards.") {
    return "ترتيب ذو أولوية وإشارة ثقة أقوى على بطاقات البائعين.";
  }
  if (normalized === "premium placement and increased visibility with serious buyers.") {
    return "ترتيب مميّز وظهور أكبر أمام المشترين الجادّين.";
  }
  if (normalized === "elite recognition across alpha exchange and maximum buyer trust.") {
    return "تقدير النخبة في Alpha Exchange وأعلى مستوى من ثقة المشترين.";
  }
  if (normalized === "starter prestige level unlocked.") return "تم فتح مستوى المكانة الأول.";
  return "تم فتح مزايا جديدة لهذه الرتبة.";
}

function entityReference(value: string) {
  return value.trim().replace(/^(?:Listing|Trade|Commission|Dispute|Application)\s+(?=#)/i, "");
}

const ARABIC_MESSAGE_TEMPLATES: NotificationMessageTemplate[] = [
  {
    pattern: /^Pay (.+?) USDT commission before accepting, publishing, renewing, or starting another trade\.$/i,
    translate: ([amount]) => `ادفع عمولة بقيمة ${amount} USDT قبل قبول صفقة أخرى أو نشر عرض أو تجديده أو بدء عملية شراء جديدة.`,
  },
  {
    pattern: /^Listing (.+?) expired and is no longer visible to buyers\. Open My Listings to renew it when you are ready\.$/i,
    translate: ([listing]) => `انتهت صلاحية العرض ${entityReference(listing)} ولم يعد ظاهرًا للمشترين. افتح «عروضي» لتجديده عندما تكون جاهزًا.`,
  },
  {
    pattern: /^(.+)'s listing (.+?) expired\.$/i,
    translate: ([seller, listing]) => `انتهت صلاحية عرض ${seller} رقم ${entityReference(listing)}.`,
  },
  {
    pattern: /^Commission for trade (.+?) is overdue and requires payment\.$/i,
    translate: ([trade]) => `تأخر دفع عمولة الصفقة ${entityReference(trade)} وأصبحت بحاجة إلى السداد.`,
  },
  {
    pattern: /^Commission for trade (.+?) is now overdue\.$/i,
    translate: ([trade]) => `أصبحت عمولة الصفقة ${entityReference(trade)} متأخرة عن موعد السداد.`,
  },
  {
    pattern: /^Trade (.+?) is still active, but requires your next step\. Please upload payment proof to continue\.$/i,
    translate: ([trade]) => `الصفقة ${entityReference(trade)} ما زالت نشطة وتحتاج إلى خطوتك التالية. ارفع إثبات الدفع للمتابعة.`,
  },
  {
    pattern: /^Trade (.+?) is still active\. We reminded the buyer to continue the flow\.$/i,
    translate: ([trade]) => `الصفقة ${entityReference(trade)} ما زالت نشطة. ذكّرنا المشتري بمتابعة الخطوات.`,
  },
  {
    pattern: /^Trade (.+?) exceeded the USDT release deadline\. You can open a dispute now\.$/i,
    translate: ([trade]) => `تجاوزت الصفقة ${entityReference(trade)} مهلة إرسال USDT. يمكنك فتح نزاع الآن.`,
  },
  {
    pattern: /^Trade (.+?) exceeded the 45-minute release window and is now overdue\.$/i,
    translate: ([trade]) => `تجاوزت الصفقة ${entityReference(trade)} مهلة الإرسال البالغة 45 دقيقة وأصبحت متأخرة.`,
  },
  {
    pattern: /^Trade (.+?) exceeded the 45-minute USDT release SLA\.$/i,
    translate: ([trade]) => `تجاوزت الصفقة ${entityReference(trade)} مهلة إرسال USDT البالغة 45 دقيقة.`,
  },
  {
    pattern: /^Your trust score increased from (.+?) to (.+?)\.$/i,
    translate: ([oldScore, newScore]) => `ارتفعت درجة الثقة لديك من ${oldScore} إلى ${newScore}.`,
  },
  {
    pattern: /^Your prestige rank changed from (.+?) to (.+?)\.$/i,
    translate: ([oldRank, newRank]) => `تغيّرت رتبتك من ${arabicSellerRank(oldRank)} إلى ${arabicSellerRank(newRank)}.`,
  },
  {
    pattern: /^You reached (.+?) seller\. (.+)$/i,
    translate: ([rank, benefit]) => `وصلت إلى رتبة البائع ${arabicSellerRank(rank)}. ${arabicPromotionBenefit(benefit)}`,
  },
  {
    pattern: /^(.+?) dropped from (.+?) to (.+?)\.$/i,
    translate: ([seller, oldScore, newScore]) => `انخفضت درجة ثقة ${seller} من ${oldScore} إلى ${newScore}.`,
  },
  {
    pattern: /^(.+?) triggered trust\/risk signals\. Trust score: (.+?)\/100\.$/i,
    translate: ([seller, score]) => `فعّل ${seller} مؤشرات الثقة والمخاطر. درجة الثقة: ${score}/100.`,
  },
  {
    pattern: /^(.+?) has applied to become an Approved Seller\.$/i,
    translate: ([seller]) => `قدّم ${seller} طلبًا للانضمام كبائع معتمد.`,
  },
  {
    pattern: /^A Marketplace Recovery Fee of (.+?) USDT was issued\. Complete payment to (.+?) on (.+?) and submit proof for verification to restore listing access\.$/i,
    translate: ([amount, wallet, network]) =>
      `تم إصدار رسوم استعادة للسوق بقيمة ${amount} USDT. ادفع إلى ${wallet} على شبكة ${network} ثم أرسل الإثبات للتحقق واستعادة صلاحية إنشاء العروض.`,
  },
  {
    pattern: /^(.+?) submitted payment proof for enforcement (.+?)\.$/i,
    translate: ([seller, enforcement]) => `أرسل ${seller} إثبات دفع لحالة الامتثال ${enforcement}.`,
  },
  {
    pattern: /^(.+?) submitted a compliance appeal\.$/i,
    translate: ([seller]) => `قدّم ${seller} استئنافًا على قرار الامتثال.`,
  },
  {
    pattern: /^Your prestige rank is now (.+?) based on completed volume\.$/i,
    translate: ([rank]) => `أصبحت رتبتك الآن ${arabicSellerRank(rank)} بناءً على حجم الصفقات المكتملة.`,
  },
  {
    pattern: /^Your prestige rank was set to (.+?) by Alpha Traders admin\.$/i,
    translate: ([rank]) => `ضبطت إدارة Alpha Traders رتبتك على ${arabicSellerRank(rank)}.`,
  },
  {
    pattern: /^(.+?) submitted listing (.+?) for admin approval\.$/i,
    translate: ([seller, listing]) => `أرسل ${seller} العرض ${entityReference(listing)} للحصول على موافقة الإدارة.`,
  },
  {
    pattern: /^Listing (.+?) was submitted for admin review\.$/i,
    translate: ([listing]) => `أُرسل العرض ${entityReference(listing)} لمراجعة الإدارة.`,
  },
  {
    pattern: /^(.+?) resubmitted listing (.+?) for admin approval\.$/i,
    translate: ([seller, listing]) => `أعاد ${seller} إرسال العرض ${entityReference(listing)} للحصول على موافقة الإدارة.`,
  },
  {
    pattern: /^Listing (.+?) has been renewed and is live again\.$/i,
    translate: ([listing]) => `تم تجديد العرض ${entityReference(listing)} وأصبح منشورًا من جديد.`,
  },
  {
    pattern: /^(.+?) is now in Vacation Mode\.$/i,
    translate: ([seller]) => `أصبح ${seller} الآن في وضع الإجازة.`,
  },
  {
    pattern: /^Trade (.+?) was cancelled by an admin listing action\.$/i,
    translate: ([trade]) => `أُلغيت الصفقة ${entityReference(trade)} بسبب إجراء إداري على العرض.`,
  },
  {
    pattern: /^An admin renewed listing (.+?)\.$/i,
    translate: ([listing]) => `جدّدت الإدارة العرض ${entityReference(listing)}.`,
  },
  {
    pattern: /^An admin extended the expiration for listing (.+?)\.$/i,
    translate: ([listing]) => `مدّدت الإدارة صلاحية العرض ${entityReference(listing)}.`,
  },
  {
    pattern: /^An admin (force-closed|closed) listing (.+?)\.$/i,
    translate: ([action, listing]) => action.toLowerCase() === "force-closed"
      ? `أغلقت الإدارة العرض ${entityReference(listing)} إغلاقًا إجباريًا.`
      : `أغلقت الإدارة العرض ${entityReference(listing)}.`,
  },
  {
    pattern: /^Listing (.+?) was force-closed successfully\.$/i,
    translate: ([listing]) => `تم إغلاق العرض ${entityReference(listing)} إغلاقًا إجباريًا بنجاح.`,
  },
  {
    pattern: /^Your listing was rejected\.\s*Reason:\s*([\s\S]+)$/i,
    translate: ([reason]) => `تم رفض عرضك.\nالسبب: ${reason}`,
  },
  {
    pattern: /^Your listing needs updates before approval\.\s*Reason:\s*([\s\S]+)$/i,
    translate: ([reason]) => `يحتاج عرضك إلى تعديلات قبل الموافقة.\nالسبب: ${reason}`,
  },
  {
    pattern: /^(.+?) published (.+?) USDT on (.+?) at (.+?) (.+?)\/USDT\.$/i,
    translate: ([seller, amount, network, price, currency]) =>
      `نشر ${seller} عرضًا بقيمة ${amount} USDT على شبكة ${network} بسعر ${price} ${currency}/USDT.`,
  },
  {
    pattern: /^Listing (.+?) is not available for a new buyer right now\.$/i,
    translate: ([listing]) => `العرض ${entityReference(listing)} غير متاح لمشترٍ جديد في الوقت الحالي.`,
  },
  {
    pattern: /^The seller is currently unavailable for listing (.+?)\.$/i,
    translate: ([listing]) => `البائع غير متاح حاليًا للعرض ${entityReference(listing)}.`,
  },
  {
    pattern: /^(.+?) submitted a (.+?) trade request\.$/i,
    translate: ([buyer, method]) => `قدّم ${buyer} طلب صفقة بطريقة ${arabicPaymentMethod(method)}.`,
  },
  {
    pattern: /^(.+?) offered ₪(.+?) per USDT for (.+?) USDT\.$/i,
    translate: ([buyer, price, amount]) => `قدّم ${buyer} عرض سعر بقيمة ₪${price} لكل USDT لشراء ${amount} USDT.`,
  },
  {
    pattern: /^(.+?) offered ₪(.+?) per USDT for (.+?) USDT from (.+?)\.$/i,
    translate: ([buyer, price, amount, seller]) => `قدّم ${buyer} إلى ${seller} عرض سعر بقيمة ₪${price} لكل USDT لشراء ${amount} USDT.`,
  },
  {
    pattern: /^Seller accepted your price offer of ₪(.+?) per USDT\. You can now continue in the Trade Room\.$/i,
    translate: ([price]) => `وافق البائع على عرضك بسعر ₪${price} لكل USDT. يمكنك الآن المتابعة في غرفة التداول.`,
  },
  {
    pattern: /^The seller declined your price offer of ₪(.+?) per USDT\.$/i,
    translate: ([price]) => `رفض البائع عرضك بسعر ₪${price} لكل USDT.`,
  },
  {
    pattern: /^(.+?) requested (.+?) USDT from (.+?)\.$/i,
    translate: ([buyer, amount, seller]) => `طلب ${buyer} شراء ${amount} USDT من ${seller}.`,
  },
  {
    pattern: /^The trade was closed manually\. Reason: (.+?)\. ([\s\S]+)$/i,
    translate: ([reason, explanation]) => `أُغلقت الصفقة يدويًا. السبب: ${reason}. ${explanation}`,
  },
  {
    pattern: /^The trade was closed manually\. Reason: (.+?)\.$/i,
    translate: ([reason]) => `أُغلقت الصفقة يدويًا. السبب: ${reason}.`,
  },
  {
    pattern: /^You closed this trade\. Reason: (.+?)\.$/i,
    translate: ([reason]) => `أغلقت هذه الصفقة. السبب: ${reason}.`,
  },
  {
    pattern: /^Request (.+?) was declined because the listing matched another buyer\.$/i,
    translate: ([request]) => `رُفض الطلب ${entityReference(request)} لأن العرض ارتبط بمشترٍ آخر.`,
  },
  {
    pattern: /^Seller accepted (.+?)'s (.+?) USDT request\. The trade is now active\.$/i,
    translate: ([buyer, amount]) => `قبل البائع طلب ${buyer} لشراء ${amount} USDT. الصفقة نشطة الآن.`,
  },
  {
    pattern: /^Seller accepted (.+?)'s offer of ₪(.+?) per USDT for (.+?) USDT\. The trade is now active\.$/i,
    translate: ([buyer, price, amount]) => `وافق البائع على عرض ${buyer} بسعر ₪${price} لكل USDT لشراء ${amount} USDT. الصفقة نشطة الآن.`,
  },
  {
    pattern: /^Trade (.+?) completed at (.+?) (.+?) \(threshold (.+?)\)\.$/i,
    translate: ([trade, currency, amount, threshold]) =>
      `اكتملت الصفقة ${entityReference(trade)} بقيمة ${amount} ${currency} (حد التنبيه: ${threshold}).`,
  },
  {
    pattern: /^Your commission payment for trade (.+?) was verified\. Your account is now fully unlocked\.$/i,
    translate: ([trade]) => `تم التحقق من دفع عمولة الصفقة ${entityReference(trade)}. أُعيد تفعيل حسابك بالكامل.`,
  },
  {
    pattern: /^Commission (.+?) paid via (.+?)\. Amount: (.+?) USDT\. Tx: ([\s\S]+)$/i,
    translate: ([commission, network, amount, transaction]) =>
      `دُفعت العمولة ${entityReference(commission)} عبر ${network}. المبلغ: ${amount} USDT. معرّف المعاملة: ${transaction}`,
  },
  {
    pattern: /^Commission for trade (.+?) has been marked paid\.$/i,
    translate: ([trade]) => `تم تسجيل عمولة الصفقة ${entityReference(trade)} كمدفوعة.`,
  },
  {
    pattern: /^(.+?) submitted (bug|suggestion|confusing_ux|feature_request|performance|other) feedback\.$/i,
    translate: ([user, category]) => `أرسل ${user} تقييمًا ${arabicFeedbackCategory(category)}.`,
  },
  {
    pattern: /^Dispute opened for trade (.+?)\.$/i,
    translate: ([trade]) => `فُتح نزاع للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^A dispute was opened for trade (.+?)\.$/i,
    translate: ([trade]) => `فُتح نزاع للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Seller (.+?) has (.+?) buyer reports\.$/i,
    translate: ([seller, count]) => `لدى البائع ${seller} عدد ${count} من بلاغات المشترين.`,
  },
];

const ARABIC_ACTIVITY_DETAILS_BY_ENGLISH: Record<string, string> = {
  "your seller application is pending owner review.": "طلبك للانضمام كبائع بانتظار مراجعة المالك.",
  "you can now create listings as an approved seller.": "يمكنك الآن إنشاء عروض بصفتك بائعًا معتمدًا.",
  "you can update details and apply again.": "يمكنك تحديث البيانات ثم تقديم الطلب مرة أخرى.",
};

const ARABIC_ACTIVITY_DETAILS_TEMPLATES: NotificationMessageTemplate[] = [
  {
    pattern: /^Offer for trade (.+?) was submitted at ₪(.+?) per USDT\.$/i,
    translate: ([trade, price]) => `تم إرسال عرض السعر للصفقة ${entityReference(trade)} بقيمة ₪${price} لكل USDT.`,
  },
  {
    pattern: /^Trust score improved to (.+?)\.$/i,
    translate: ([score]) => `تحسّنت درجة الثقة إلى ${score}.`,
  },
  {
    pattern: /^Prestige rank is now (.+?)\.$/i,
    translate: ([rank]) => `أصبحت رتبة البائع الآن ${arabicSellerRank(rank)}.`,
  },
  {
    pattern: /^Promoted to (.+?) seller\.$/i,
    translate: ([rank]) => `تمت الترقية إلى رتبة البائع ${arabicSellerRank(rank)}.`,
  },
  {
    pattern: /^Listing (.+?) is pending admin approval before going live\.$/i,
    translate: ([listing]) => `العرض ${entityReference(listing)} بانتظار موافقة الإدارة قبل نشره.`,
  },
  {
    pattern: /^Listing (.+?) was resubmitted and is pending admin approval\.$/i,
    translate: ([listing]) => `أُعيد إرسال العرض ${entityReference(listing)}، وهو بانتظار موافقة الإدارة.`,
  },
  {
    pattern: /^Listing (.+?) approved and now live\.$/i,
    translate: ([listing]) => `تمت الموافقة على العرض ${entityReference(listing)}، وهو منشور الآن.`,
  },
  {
    pattern: /^Reason:\s*([\s\S]+)$/i,
    translate: ([reason]) => `السبب: ${reason}`,
  },
  {
    pattern: /^Trade (.+?) was submitted\.$/i,
    translate: ([trade]) => `تم إرسال طلب الصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^(Payment|USDT) evidence uploaded for trade (.+?)\.$/i,
    translate: ([evidenceType, trade]) => evidenceType.toLowerCase() === "payment"
      ? `تم رفع إثبات الدفع للصفقة ${entityReference(trade)}.`
      : `تم رفع إثبات إرسال USDT للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Review submitted for trade (.+?)\.$/i,
    translate: ([trade]) => `تم إرسال التقييم للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Response sent for trade (.+?)\.$/i,
    translate: ([trade]) => `تم إرسال الرد للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Trade (.+?) completed\.$/i,
    translate: ([trade]) => `اكتملت الصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Category:\s*(bug|suggestion|confusing_ux|feature_request|performance|other)$/i,
    translate: ([category]) => `الفئة: ${arabicFeedbackCategory(category).replace(/^(?:عن|يتضمن|ضمن فئة)\s+/, "")}`,
  },
  {
    pattern: /^inApp=(true|false),\s*email=(true|false),\s*sms=(true|false)$/i,
    translate: ([inApp, email, sms]) =>
      `داخل التطبيق: ${inApp === "true" ? "مفعّل" : "غير مفعّل"}، البريد الإلكتروني: ${email === "true" ? "مفعّل" : "غير مفعّل"}، الرسائل القصيرة: ${sms === "true" ? "مفعّلة" : "غير مفعّلة"}`,
  },
  {
    pattern: /^Dispute opened for trade (.+?)\.$/i,
    translate: ([trade]) => `فُتح نزاع للصفقة ${entityReference(trade)}.`,
  },
  {
    pattern: /^Report submitted against seller ([\s\S]+)\.$/i,
    translate: ([seller]) => `تم إرسال بلاغ ضد البائع ${seller}.`,
  },
];

export function containsArabicText(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

function categoryTitle(category: AlphaExchangeNotification["category"]) {
  if (category === "trade") return "تحديث على الصفقة";
  if (category === "listing") return "تحديث على العرض";
  if (category === "application") return "تحديث على طلب البائع";
  if (category === "trust") return "تحديث على الثقة والرتبة";
  if (category === "review") return "تحديث على التقييم";
  if (category === "dispute") return "تحديث على النزاع";
  if (category === "report") return "تحديث على بلاغ في السوق";
  if (category === "account") return "تحديث على الحساب";
  return "تحديث جديد من Alpha Traders";
}

function categoryMessage(category: AlphaExchangeNotification["category"]) {
  if (category === "trade") return "يوجد تحديث جديد على صفقتك. افتح غرفة التداول لمعرفة التفاصيل والخطوة المطلوبة.";
  if (category === "listing") return "يوجد تحديث جديد على أحد عروضك. افتح إدارة العروض لمعرفة التفاصيل.";
  if (category === "application") return "يوجد تحديث على طلب البائع. افتح الطلب لمعرفة التفاصيل.";
  if (category === "trust") return "يوجد تحديث على درجة الثقة أو رتبة البائع.";
  if (category === "review") return "يوجد تحديث جديد متعلق بتقييم صفقة.";
  if (category === "dispute") return "يوجد تحديث على نزاع. افتح التفاصيل للمراجعة.";
  if (category === "report") return "يوجد تحديث متعلق ببلاغ في السوق.";
  if (category === "account") return "يوجد تحديث جديد على حسابك.";
  return "يوجد تحديث جديد في حسابك. افتح التفاصيل لمعرفة المزيد.";
}

function categoryActivityDetails(category: AlphaExchangeActivityLogEntry["category"]) {
  if (category === "trade") return "تم تسجيل تحديث جديد متعلق بإحدى صفقاتك.";
  if (category === "listing") return "تم تسجيل تحديث جديد متعلق بأحد عروضك.";
  if (category === "application") return "تم تسجيل تحديث جديد على طلب البائع.";
  if (category === "trust") return "تم تسجيل تحديث جديد على درجة الثقة أو رتبة البائع.";
  if (category === "review") return "تم تسجيل تحديث جديد متعلق بتقييم صفقة.";
  if (category === "dispute") return "تم تسجيل تحديث جديد متعلق بنزاع.";
  if (category === "report") return "تم تسجيل تحديث جديد متعلق ببلاغ في السوق.";
  if (category === "account") return "تم تسجيل تحديث جديد على الحساب.";
  return "تم تسجيل نشاط جديد في حسابك.";
}

function translateDynamicTitle(title: string) {
  const marketplaceAnnouncement = title.match(/^marketplace announcement:\s*(.+)$/i);
  if (marketplaceAnnouncement) {
    const announcementTitle = marketplaceAnnouncement[1].trim();
    return containsArabicText(announcementTitle) ? `إعلان السوق: ${announcementTitle}` : "إعلان جديد في السوق";
  }
  const dynamicPrefixes: Array<[RegExp, string]> = [
    [/^trust score drop:\s*(.+)$/i, "انخفاض درجة الثقة: $1"],
    [/^flagged seller:\s*(.+)$/i, "بائع تحت المراجعة: $1"],
    [/^compliance payment:\s*(.+)$/i, "دفعة امتثال: $1"],
    [/^compliance appeal:\s*(.+)$/i, "استئناف امتثال: $1"],
  ];
  for (const [pattern, replacement] of dynamicPrefixes) {
    if (pattern.test(title)) return title.replace(pattern, replacement);
  }
  return null;
}

function translateNotificationMessage(message: string) {
  const exact = ARABIC_MESSAGE_BY_ENGLISH[message.toLowerCase()];
  if (exact) return exact;
  for (const template of ARABIC_MESSAGE_TEMPLATES) {
    const match = message.match(template.pattern);
    if (match) return template.translate(match.slice(1).map((capture) => capture.trim()));
  }
  return null;
}

function translateActivityDetails(details: string) {
  const exact = ARABIC_ACTIVITY_DETAILS_BY_ENGLISH[details.toLowerCase()];
  if (exact) return exact;
  for (const template of ARABIC_ACTIVITY_DETAILS_TEMPLATES) {
    const match = details.match(template.pattern);
    if (match) return template.translate(match.slice(1).map((capture) => capture.trim()));
  }
  return null;
}

export function localizeNotificationCopy(notification: AlphaExchangeNotification, locale: AppLocale) {
  if (locale !== "ar") {
    return {
      title: notification.titleEn?.trim() || notification.title,
      message: notification.messageEn?.trim() || notification.message,
    };
  }

  const explicitTitle = notification.titleAr?.trim();
  const explicitMessage = notification.messageAr?.trim();
  if (explicitTitle && explicitMessage) {
    return { title: explicitTitle, message: explicitMessage };
  }

  const title = notification.title.trim();
  const knownTitle = ARABIC_TITLE_BY_ENGLISH[title.toLowerCase()] ?? translateDynamicTitle(title);
  const translatedTitle = explicitTitle ?? knownTitle ?? (containsArabicText(title) ? title : categoryTitle(notification.category));
  const rawMessage = notification.message.trim();
  const knownMessage = translateNotificationMessage(rawMessage);
  const message = explicitMessage ?? knownMessage ?? (containsArabicText(rawMessage) ? rawMessage : categoryMessage(notification.category));
  return { title: translatedTitle, message };
}

export function localizeActivityCopy(entry: AlphaExchangeActivityLogEntry, locale: AppLocale) {
  if (locale !== "ar") return { title: entry.title, details: entry.details };

  const title = entry.title.trim();
  const knownTitle = ARABIC_TITLE_BY_ENGLISH[title.toLowerCase()] ?? translateDynamicTitle(title);
  const translatedTitle = knownTitle ?? (containsArabicText(title) ? title : categoryTitle(entry.category));
  const rawDetails = entry.details.trim();
  const knownDetails = translateActivityDetails(rawDetails);
  const details = knownDetails ?? (containsArabicText(rawDetails) ? rawDetails : categoryActivityDetails(entry.category));
  return { title: translatedTitle, details };
}

export function localizeNotificationActionLabel(
  label: string | null | undefined,
  locale: AppLocale,
  notification: Pick<AlphaExchangeNotification, "category">,
) {
  const normalized = label?.trim();
  if (locale !== "ar") return normalized || "Open";
  if (normalized && containsArabicText(normalized)) return normalized;
  if (normalized && ARABIC_ACTION_BY_ENGLISH[normalized.toLowerCase()]) return ARABIC_ACTION_BY_ENGLISH[normalized.toLowerCase()];
  if (notification.category === "trade") return "متابعة الصفقة";
  if (notification.category === "listing") return "إدارة العرض";
  if (notification.category === "application") return "مراجعة الطلب";
  return "عرض التفاصيل";
}
