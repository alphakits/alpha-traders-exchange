import { describe, expect, it } from "vitest";
import {
  containsArabicText,
  localizeActivityCopy,
  localizeNotificationActionLabel,
  localizeNotificationCopy,
} from "@/lib/notification-localization";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, NotificationCategory } from "@/types/alpha-exchange";

function notification(input: {
  title?: string;
  message: string;
  category?: NotificationCategory;
}): AlphaExchangeNotification {
  return {
    id: "notification-test",
    userId: "user-test",
    category: input.category ?? "trade",
    title: input.title ?? "Action required",
    message: input.message,
    isRead: false,
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}

function activity(input: {
  title: string;
  details: string;
  category?: NotificationCategory;
}): AlphaExchangeActivityLogEntry {
  return {
    id: "activity-test",
    userId: "user-test",
    category: input.category ?? "trade",
    title: input.title,
    details: input.details,
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("notification localization", () => {
  const exactMessageCases = [
    ["Your seller account is approved and now active.", "تمت الموافقة على حساب البائع الخاص بك، وهو نشط الآن."],
    ["Your seller application was rejected.", "تم رفض طلبك للانضمام كبائع."],
    [
      "Your Marketplace Recovery Fee payment was submitted and is awaiting owner verification.",
      "تم إرسال دفعة رسوم استعادة السوق، وهي بانتظار تحقق المالك.",
    ],
    ["Your compliance appeal was accepted.", "تم قبول استئناف الامتثال الخاص بك."],
    ["Your compliance appeal was reviewed and rejected.", "تمت مراجعة استئناف الامتثال الخاص بك ورفضه."],
    [
      "Your Marketplace Recovery Fee was confirmed and the compliance restriction is now cleared. Listing and publishing permissions are restored.",
      "تم تأكيد رسوم استعادة السوق ورفع تقييد الامتثال. استُعيدت صلاحيات إنشاء العروض ونشرها.",
    ],
    [
      "Your marketplace compliance restriction was removed by owner review. Listing and publishing permissions are restored.",
      "أزال المالك تقييد الامتثال بعد المراجعة. استُعيدت صلاحيات إنشاء العروض ونشرها.",
    ],
    [
      "Your seller marketplace privileges were permanently revoked after repeated policy violations. Existing active trades remain available for completion.",
      "أُلغيت صلاحياتك كبائع في السوق نهائيًا بعد مخالفات متكررة للسياسات. تبقى صفقاتك النشطة متاحة لإكمالها.",
    ],
    [
      "Your listings are now hidden from buyers until you switch back to Available or Away.",
      "عروضك مخفية الآن عن المشترين حتى تغيّر حالتك إلى متاح أو بعيد.",
    ],
    ["Your seller availability is now set to Away.", "تم ضبط حالة توفرك كبائع على بعيد."],
    ["Your listings are visible to buyers again.", "أصبحت عروضك ظاهرة للمشترين من جديد."],
    ["Your listing has been approved and is now live in the marketplace.", "تمت الموافقة على عرضك، وهو منشور الآن في السوق."],
    ["You have a new message in your active Alpha Exchange trade.", "لديك رسالة جديدة في صفقتك النشطة على Alpha Exchange."],
    ["Your Buyer is waiting for you in an active trade.", "المشتري بانتظارك في صفقة نشطة."],
    ["Your Seller is waiting for you in an active trade.", "البائع بانتظارك في صفقة نشطة."],
    [
      "Buyer marked payment as sent. Please verify the funds in your bank account.",
      "أكد المشتري إرسال الدفعة. تحقّق من وصول الأموال إلى حسابك البنكي.",
    ],
    [
      "Buyer has prepared the cardless withdrawal. Confirm after collecting the cash.",
      "جهّز المشتري السحب دون بطاقة. أكّد العملية بعد استلام النقد.",
    ],
    [
      "Buyer marked payment as sent. Confirm funds in person after following safety guidelines.",
      "أكد المشتري إرسال الدفعة. أكّد استلام الأموال وجهًا لوجه بعد اتباع إرشادات الأمان.",
    ],
    ["Seller marked USDT as sent. Please confirm receipt to complete the trade.", "أكد البائع إرسال USDT. أكّد الاستلام لإكمال الصفقة."],
    ["A buyer submitted a review for a completed trade.", "أرسل أحد المشترين تقييمًا لصفقة مكتملة."],
    ["The seller responded to your completed trade review.", "ردّ البائع على تقييمك للصفقة المكتملة."],
    ["Your meeting is ready. Review the safety guidelines before meeting.", "تم تجهيز موعد اللقاء. راجع إرشادات الأمان قبل المقابلة."],
    ["Seller accepted your trade request. You can now upload your payment receipt.", "قبل البائع طلب الصفقة. يمكنك الآن رفع إيصال الدفع."],
    ["Your trade request was declined by the seller.", "رفض البائع طلب الصفقة الخاص بك."],
    ["The buyer cancelled this trade request.", "ألغى المشتري طلب الصفقة هذا."],
    ["Seller verified the bank transfer and confirmed funds received.", "تحقّق البائع من التحويل البنكي وأكد استلام الأموال."],
    ["Seller confirmed cash was collected from the cardless ATM.", "أكد البائع استلام النقد من الصراف الآلي دون بطاقة."],
    ["Seller confirmed in-person payment was received.", "أكد البائع استلام الدفعة وجهًا لوجه."],
    ["Seller started the USDT release process. The 45-minute window has begun.", "بدأ البائع عملية إرسال USDT. بدأت مهلة الـ 45 دقيقة."],
    ["Your trade is complete and has been moved to your trade history.", "اكتملت صفقتك ونُقلت إلى سجل الصفقات."],
    ["You can now leave a rating and review for this trade.", "يمكنك الآن إضافة تقييم ومراجعة لهذه الصفقة."],
    [
      "Buyer confirmed receipt. The trade is complete. Check your commission due.",
      "أكد المشتري الاستلام واكتملت الصفقة. تحقّق من العمولة المستحقة عليك.",
    ],
  ] as const;

  it.each(exactMessageCases)("translates exact store message: %s", (source, expected) => {
    const copy = localizeNotificationCopy(notification({ message: source }), "ar");
    expect(copy.message).toBe(expected);
    expect(containsArabicText(copy.message)).toBe(true);
  });

  const dynamicMessageCases = [
    [
      "Listing #LS-000321 expired and is no longer visible to buyers. Open My Listings to renew it when you are ready.",
      "انتهت صلاحية العرض #LS-000321 ولم يعد ظاهرًا للمشترين. افتح «عروضي» لتجديده عندما تكون جاهزًا.",
    ],
    ["Noor's listing #LS-000321 expired.", "انتهت صلاحية عرض Noor رقم #LS-000321."],
    ["Noor's listing Listing #LS-000321 expired.", "انتهت صلاحية عرض Noor رقم #LS-000321."],
    ["Commission for trade #TR-000777 is overdue and requires payment.", "تأخر دفع عمولة الصفقة #TR-000777 وأصبحت بحاجة إلى السداد."],
    ["Commission for trade #TR-000777 is now overdue.", "أصبحت عمولة الصفقة #TR-000777 متأخرة عن موعد السداد."],
    ["Commission for trade Trade #TR-000777 is now overdue.", "أصبحت عمولة الصفقة #TR-000777 متأخرة عن موعد السداد."],
    [
      "Trade #TR-000777 is still active, but requires your next step. Please upload payment proof to continue.",
      "الصفقة #TR-000777 ما زالت نشطة وتحتاج إلى خطوتك التالية. ارفع إثبات الدفع للمتابعة.",
    ],
    ["Trade #TR-000777 is still active. We reminded the buyer to continue the flow.", "الصفقة #TR-000777 ما زالت نشطة. ذكّرنا المشتري بمتابعة الخطوات."],
    ["Trade #TR-000777 exceeded the USDT release deadline. You can open a dispute now.", "تجاوزت الصفقة #TR-000777 مهلة إرسال USDT. يمكنك فتح نزاع الآن."],
    ["Trade #TR-000777 exceeded the 45-minute release window and is now overdue.", "تجاوزت الصفقة #TR-000777 مهلة الإرسال البالغة 45 دقيقة وأصبحت متأخرة."],
    ["Trade #TR-000777 exceeded the 45-minute USDT release SLA.", "تجاوزت الصفقة #TR-000777 مهلة إرسال USDT البالغة 45 دقيقة."],
    ["Your trust score increased from 71.5 to 84.0.", "ارتفعت درجة الثقة لديك من 71.5 إلى 84.0."],
    ["Your prestige rank changed from silver to gold.", "تغيّرت رتبتك من الفضية إلى الذهبية."],
    [
      "You reached gold seller. Priority placement and stronger trust signaling on seller cards.",
      "وصلت إلى رتبة البائع الذهبية. ترتيب ذو أولوية وإشارة ثقة أقوى على بطاقات البائعين.",
    ],
    ["محمد النجار dropped from 82.0 to 63.5.", "انخفضت درجة ثقة محمد النجار من 82.0 إلى 63.5."],
    ["محمد النجار triggered trust/risk signals. Trust score: 49.2/100.", "فعّل محمد النجار مؤشرات الثقة والمخاطر. درجة الثقة: 49.2/100."],
    ["Layla Haddad has applied to become an Approved Seller.", "قدّم Layla Haddad طلبًا للانضمام كبائع معتمد."],
    [
      "A Marketplace Recovery Fee of 25.00 USDT was issued. Complete payment to TX9-wallet-ABC on TRC20 and submit proof for verification to restore listing access.",
      "تم إصدار رسوم استعادة للسوق بقيمة 25.00 USDT. ادفع إلى TX9-wallet-ABC على شبكة TRC20 ثم أرسل الإثبات للتحقق واستعادة صلاحية إنشاء العروض.",
    ],
    ["محمد النجار submitted payment proof for enforcement enforcement-908.", "أرسل محمد النجار إثبات دفع لحالة الامتثال enforcement-908."],
    ["محمد النجار submitted a compliance appeal.", "قدّم محمد النجار استئنافًا على قرار الامتثال."],
    ["Your prestige rank is now diamond based on completed volume.", "أصبحت رتبتك الآن الماسية بناءً على حجم الصفقات المكتملة."],
    ["Your prestige rank was set to elite by Alpha Traders admin.", "ضبطت إدارة Alpha Traders رتبتك على النخبة."],
    ["Noor submitted listing #LS-000321 for admin approval.", "أرسل Noor العرض #LS-000321 للحصول على موافقة الإدارة."],
    ["Listing #LS-000321 was submitted for admin review.", "أُرسل العرض #LS-000321 لمراجعة الإدارة."],
    ["نور resubmitted listing #LS-000321 for admin approval.", "أعاد نور إرسال العرض #LS-000321 للحصول على موافقة الإدارة."],
    ["Listing #LS-000321 has been renewed and is live again.", "تم تجديد العرض #LS-000321 وأصبح منشورًا من جديد."],
    ["نور is now in Vacation Mode.", "أصبح نور الآن في وضع الإجازة."],
    ["Trade #TR-000777 was cancelled by an admin listing action.", "أُلغيت الصفقة #TR-000777 بسبب إجراء إداري على العرض."],
    ["An admin renewed listing #LS-000321.", "جدّدت الإدارة العرض #LS-000321."],
    ["An admin renewed listing Listing #LS-000321.", "جدّدت الإدارة العرض #LS-000321."],
    ["An admin extended the expiration for listing #LS-000321.", "مدّدت الإدارة صلاحية العرض #LS-000321."],
    ["An admin force-closed listing #LS-000321.", "أغلقت الإدارة العرض #LS-000321 إغلاقًا إجباريًا."],
    ["Listing #LS-000321 was force-closed successfully.", "تم إغلاق العرض #LS-000321 إغلاقًا إجباريًا بنجاح."],
    ["Your listing was rejected.\nReason: Missing bank proof", "تم رفض عرضك.\nالسبب: Missing bank proof"],
    ["Your listing needs updates before approval.\nReason: حدّث السعر", "يحتاج عرضك إلى تعديلات قبل الموافقة.\nالسبب: حدّث السعر"],
    [
      "Noor published 250.50 USDT on TRC20 at 3.74 ILS/USDT.",
      "نشر Noor عرضًا بقيمة 250.50 USDT على شبكة TRC20 بسعر 3.74 ILS/USDT.",
    ],
    ["Listing #LS-000321 is not available for a new buyer right now.", "العرض #LS-000321 غير متاح لمشترٍ جديد في الوقت الحالي."],
    ["The seller is currently unavailable for listing #LS-000321.", "البائع غير متاح حاليًا للعرض #LS-000321."],
    ["محمد submitted a Bank Transfer trade request.", "قدّم محمد طلب صفقة بطريقة تحويل بنكي."],
    ["Layla offered ₪2.95 per USDT for 1,000 USDT.", "قدّم Layla عرض سعر بقيمة ₪2.95 لكل USDT لشراء 1,000 USDT."],
    ["Layla offered ₪2.95 per USDT for 1,000 USDT from Saleh.", "قدّم Layla إلى Saleh عرض سعر بقيمة ₪2.95 لكل USDT لشراء 1,000 USDT."],
    ["Seller accepted your price offer of ₪2.95 per USDT. You can now continue in the Trade Room.", "وافق البائع على عرضك بسعر ₪2.95 لكل USDT. يمكنك الآن المتابعة في غرفة التداول."],
    ["The seller declined your price offer of ₪2.95 per USDT.", "رفض البائع عرضك بسعر ₪2.95 لكل USDT."],
    ["Noor requested 125.75 USDT from Saleh A.", "طلب Noor شراء 125.75 USDT من Saleh A."],
    ["The trade was closed manually. Reason: Safety concern. Evidence mismatch", "أُغلقت الصفقة يدويًا. السبب: Safety concern. Evidence mismatch"],
    ["The trade was closed manually. Reason: Duplicate request.", "أُغلقت الصفقة يدويًا. السبب: Duplicate request."],
    ["You closed this trade. Reason: Buyer asked to cancel.", "أغلقت هذه الصفقة. السبب: Buyer asked to cancel."],
    ["Request #RQ-0021 was declined because the listing matched another buyer.", "رُفض الطلب #RQ-0021 لأن العرض ارتبط بمشترٍ آخر."],
    [
      "Seller accepted Layla Haddad's 400.25 USDT request. The trade is now active.",
      "قبل البائع طلب Layla Haddad لشراء 400.25 USDT. الصفقة نشطة الآن.",
    ],
    [
      "Trade #TR-000777 completed at ILS 1499.00 (threshold 1000).",
      "اكتملت الصفقة #TR-000777 بقيمة 1499.00 ILS (حد التنبيه: 1000).",
    ],
    [
      "Your commission payment for trade #TR-000777 was verified. Your account is now fully unlocked.",
      "تم التحقق من دفع عمولة الصفقة #TR-000777. أُعيد تفعيل حسابك بالكامل.",
    ],
    [
      "Commission #CM-0091 paid via TRC20. Amount: 3.25 USDT. Tx: 0xABC-908",
      "دُفعت العمولة #CM-0091 عبر TRC20. المبلغ: 3.25 USDT. معرّف المعاملة: 0xABC-908",
    ],
    ["Commission for trade #TR-000777 has been marked paid.", "تم تسجيل عمولة الصفقة #TR-000777 كمدفوعة."],
    ["Layla Haddad submitted confusing_ux feedback.", "أرسل Layla Haddad تقييمًا عن تجربة استخدام غير واضحة."],
    ["Dispute opened for trade #TR-000777.", "فُتح نزاع للصفقة #TR-000777."],
    ["Dispute opened for trade Trade #TR-000777.", "فُتح نزاع للصفقة #TR-000777."],
    ["A dispute was opened for trade #TR-000777.", "فُتح نزاع للصفقة #TR-000777."],
    ["Seller محمد النجار has 3 buyer reports.", "لدى البائع محمد النجار عدد 3 من بلاغات المشترين."],
  ] as const;

  it.each(dynamicMessageCases)("translates dynamic store message and preserves its values: %s", (source, expected) => {
    const copy = localizeNotificationCopy(notification({ message: source }), "ar");
    expect(copy.message).toBe(expected);
    expect(containsArabicText(copy.message)).toBe(true);
  });

  it("translates known English scaffolds even when a dynamic name is Arabic", () => {
    const copy = localizeNotificationCopy(notification({
      title: "Trust score drop: محمد النجار",
      message: "محمد النجار dropped from 90.0 to 70.0.",
      category: "trust",
    }), "ar");

    expect(copy).toEqual({
      title: "انخفاض درجة الثقة: محمد النجار",
      message: "انخفضت درجة ثقة محمد النجار من 90.0 إلى 70.0.",
    });
    expect(copy.title).not.toContain("Trust score drop");
    expect(copy.message).not.toContain("dropped from");
  });

  it("keeps announcements Arabic-safe when an admin authored the announcement in English", () => {
    const copy = localizeNotificationCopy(notification({
      title: "Marketplace announcement: Scheduled maintenance",
      message: "Trading will pause briefly tonight.",
      category: "system",
    }), "ar");

    expect(copy).toEqual({
      title: "إعلان جديد في السوق",
      message: "يوجد تحديث جديد في حسابك. افتح التفاصيل لمعرفة المزيد.",
    });
  });

  it.each([
    ["Prestige override removed", "تمت إزالة التعديل الإداري للرتبة"],
    ["Prestige rank updated by admin", "حدّثت الإدارة رتبة البائع"],
    ["Listing Approved", "تمت الموافقة على العرض"],
    ["Listing Rejected", "تم رفض العرض"],
    ["Listing Needs Changes", "العرض يحتاج إلى تعديلات"],
    ["Listing closed", "تم إغلاق العرض"],
    ["Vacation enabled", "تم تفعيل وضع الإجازة"],
    ["Availability updated", "تم تحديث حالة التوفر"],
    ["Vacation disabled", "تم إلغاء وضع الإجازة"],
    ["Withdrawal ready", "السحب جاهز"],
    ["Buyer marked payment sent", "أكد المشتري إرسال الدفعة"],
    ["Seller confirmed cash collected", "أكد البائع استلام النقد"],
    ["Seller confirmed funds received", "أكد البائع استلام الأموال"],
    ["New price offer", "عرض سعر جديد"],
    ["Price offer accepted", "تم قبول عرض السعر"],
    ["Price offer declined", "تم رفض عرض السعر"],
  ] as const)("translates store title: %s", (source, expected) => {
    expect(localizeNotificationCopy(notification({ title: source, message: "Unknown system detail" }), "ar").title).toBe(expected);
  });

  it.each([
    ["View Trade", "عرض الصفقة"],
    ["Accept or decline this request", "قبول الطلب أو رفضه"],
    ["Accept or decline this price offer", "قبول عرض السعر أو رفضه"],
    ["Wait for seller response", "انتظار رد البائع"],
    ["Wait for seller response to your price offer", "انتظار رد البائع على عرض سعرك"],
    ["Wait for buyer payment proof", "انتظار إثبات دفع المشتري"],
    ["Upload payment proof and mark Payment Sent", "رفع إثبات الدفع وتأكيد الإرسال"],
    ["Verify payment, upload proof, then mark USDT Sent", "التحقق من الدفع ورفع الإثبات ثم تأكيد إرسال USDT"],
    ["Wait for seller USDT release", "انتظار إرسال USDT من البائع"],
    ["Wait for buyer completion confirmation", "انتظار تأكيد المشتري لإكمال الصفقة"],
    ["Confirm trade completed", "تأكيد اكتمال الصفقة"],
    ["Leave your trade review", "إضافة تقييمك للصفقة"],
    ["Trade is closed", "الصفقة مغلقة"],
    ["Open trade details", "فتح تفاصيل الصفقة"],
  ] as const)("translates action label: %s", (source, expected) => {
    expect(localizeNotificationActionLabel(source, "ar", { category: "trade" })).toBe(expected);
  });

  it("keeps English copy byte-for-byte unchanged in the English locale", () => {
    const source = notification({
      title: "Trade overdue",
      message: "Trade #TR-000777 exceeded the USDT release deadline. You can open a dispute now.",
    });
    expect(localizeNotificationCopy(source, "en")).toEqual({ title: source.title, message: source.message });
  });

  it("uses a safe Arabic category fallback for an unknown English message", () => {
    const copy = localizeNotificationCopy(notification({ message: "A future server message not yet mapped." }), "ar");
    expect(copy.message).toBe("يوجد تحديث جديد على صفقتك. افتح غرفة التداول لمعرفة التفاصيل والخطوة المطلوبة.");
    expect(copy.message).not.toContain("future server message");
  });

  const activityCases = [
    ["Trust score increased", "Trust score improved to 88.5.", "ارتفعت درجة الثقة", "تحسّنت درجة الثقة إلى 88.5."],
    ["Prestige rank updated", "Prestige rank is now gold.", "تم تحديث رتبة البائع", "أصبحت رتبة البائع الآن الذهبية."],
    ["Prestige promotion unlocked", "Promoted to diamond seller.", "تم فتح ترقية جديدة", "تمت الترقية إلى رتبة البائع الماسية."],
    [
      "Seller application submitted",
      "Your seller application is pending owner review.",
      "تم إرسال طلب البائع",
      "طلبك للانضمام كبائع بانتظار مراجعة المالك.",
    ],
    ["Application approved", "You can now create listings as an approved seller.", "تمت الموافقة على الطلب", "يمكنك الآن إنشاء عروض بصفتك بائعًا معتمدًا."],
    ["Application rejected", "You can update details and apply again.", "تم رفض الطلب", "يمكنك تحديث البيانات ثم تقديم الطلب مرة أخرى."],
    [
      "Listing submitted for review",
      "Listing #LS-000321 is pending admin approval before going live.",
      "تم إرسال العرض للمراجعة",
      "العرض #LS-000321 بانتظار موافقة الإدارة قبل نشره.",
    ],
    [
      "Listing resubmitted for review",
      "Listing Listing #LS-000321 was resubmitted and is pending admin approval.",
      "تمت إعادة إرسال العرض للمراجعة",
      "أُعيد إرسال العرض #LS-000321، وهو بانتظار موافقة الإدارة.",
    ],
    ["Listing approved", "Listing #LS-000321 approved and now live.", "تمت الموافقة على العرض", "تمت الموافقة على العرض #LS-000321، وهو منشور الآن."],
    ["Listing rejected", "Reason: Missing bank proof", "تم رفض العرض", "السبب: Missing bank proof"],
    ["Listing changes requested", "Reason: حدّث صورة البنك", "طُلبت تعديلات على العرض", "السبب: حدّث صورة البنك"],
    ["Trade request submitted", "Trade #TR-000777 was submitted.", "تم إرسال طلب الصفقة", "تم إرسال طلب الصفقة #TR-000777."],
    ["Price offer submitted", "Offer for trade #TR-000778 was submitted at ₪2.95 per USDT.", "تم إرسال عرض السعر", "تم إرسال عرض السعر للصفقة #TR-000778 بقيمة ₪2.95 لكل USDT."],
    ["Trade evidence uploaded", "Payment evidence uploaded for trade Trade #TR-000777.", "تم رفع إثبات للصفقة", "تم رفع إثبات الدفع للصفقة #TR-000777."],
    ["Trade evidence uploaded", "USDT evidence uploaded for trade #TR-000777.", "تم رفع إثبات للصفقة", "تم رفع إثبات إرسال USDT للصفقة #TR-000777."],
    ["Review submitted", "Review submitted for trade #TR-000777.", "تم إرسال التقييم", "تم إرسال التقييم للصفقة #TR-000777."],
    ["Review response sent", "Response sent for trade #TR-000777.", "تم إرسال الرد على التقييم", "تم إرسال الرد للصفقة #TR-000777."],
    ["Trade completed", "Trade #TR-000777 completed.", "اكتملت الصفقة", "اكتملت الصفقة #TR-000777."],
    ["Marketplace feedback submitted", "Category: confusing_ux", "تم إرسال تقييم السوق", "الفئة: تجربة استخدام غير واضحة"],
    [
      "Notification preferences updated",
      "inApp=true, email=false, sms=true",
      "تم تحديث تفضيلات الإشعارات",
      "داخل التطبيق: مفعّل، البريد الإلكتروني: غير مفعّل، الرسائل القصيرة: مفعّلة",
    ],
    ["Dispute opened", "Dispute opened for trade Trade #TR-000777.", "تم فتح نزاع", "فُتح نزاع للصفقة #TR-000777."],
    ["Seller reported", "Report submitted against seller محمد النجار.", "تم الإبلاغ عن البائع", "تم إرسال بلاغ ضد البائع محمد النجار."],
  ] as const;

  it.each(activityCases)("localizes activity history without losing stable values: %s / %s", (title, details, expectedTitle, expectedDetails) => {
    const copy = localizeActivityCopy(activity({ title, details }), "ar");
    expect(copy).toEqual({ title: expectedTitle, details: expectedDetails });
    expect(containsArabicText(copy.title)).toBe(true);
    expect(containsArabicText(copy.details)).toBe(true);
  });

  it("preserves a user-authored activity reason verbatim while translating only its scaffold", () => {
    const reason = "Buyer asked to cancel — طلب المشتري الإلغاء";
    const copy = localizeActivityCopy(activity({
      title: "Listing changes requested",
      details: `Reason: ${reason}`,
      category: "listing",
    }), "ar");

    expect(copy.details).toBe(`السبب: ${reason}`);
    expect(copy.details).toContain(reason);
  });

  it("keeps activity history unchanged in English and safely falls back for unknown English details", () => {
    const source = activity({ title: "Trade completed", details: "A future activity detail." });
    expect(localizeActivityCopy(source, "en")).toEqual({ title: source.title, details: source.details });
    expect(localizeActivityCopy(source, "ar")).toEqual({
      title: "اكتملت الصفقة",
      details: "تم تسجيل تحديث جديد متعلق بإحدى صفقاتك.",
    });
  });
});
