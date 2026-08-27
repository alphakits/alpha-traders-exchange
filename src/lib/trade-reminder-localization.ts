import type { AlphaExchangeTradeReminder } from "@/types/alpha-exchange";

export type LocalizedTradeReminderDisplay = {
  title: string;
  messageBeforeReference: string;
  reference: string;
  messageAfterReference: string;
  actionLabel: string;
};

export function getLocalizedTradeReminderDisplay(
  reminder: AlphaExchangeTradeReminder,
  locale: "ar" | "en",
): LocalizedTradeReminderDisplay {
  const reference = reminder.displayNumber ? `#${reminder.displayNumber}` : reminder.tradeId;

  if (locale === "ar") {
    if (reminder.kind === "feedback_required") {
      return {
        title: "التقييم مطلوب",
        messageBeforeReference: "الصفقة",
        reference,
        messageAfterReference: "بانتظار تقييمك حتى تتمكن من متابعة التداول.",
        actionLabel: "أضف تقييمك",
      };
    }
    if (reminder.kind === "buyer_action_required") {
      return {
        title: "إجراء مطلوب",
        messageBeforeReference: "الصفقة",
        reference,
        messageAfterReference: "بانتظار تأكيدك.",
        actionLabel: "افتح غرفة الصفقة",
      };
    }
    return {
      title: "إجراء مطلوب",
      messageBeforeReference: "الصفقة",
      reference,
      messageAfterReference: "بانتظار خطوتك التالية.",
      actionLabel: "افتح غرفة الصفقة",
    };
  }

  if (reminder.kind === "feedback_required") {
    return {
      title: "Feedback required",
      messageBeforeReference: "Trade",
      reference,
      messageAfterReference: "is waiting for your feedback so you can keep trading.",
      actionLabel: "Leave feedback",
    };
  }
  if (reminder.kind === "buyer_action_required") {
    return {
      title: "Action required",
      messageBeforeReference: "Trade",
      reference,
      messageAfterReference: "is waiting for your confirmation.",
      actionLabel: "Open trade room",
    };
  }
  return {
    title: "Action required",
    messageBeforeReference: "Trade",
    reference,
    messageAfterReference: "is waiting for your next step.",
    actionLabel: "Open trade room",
  };
}
