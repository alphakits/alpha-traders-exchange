import type { MobileLocale } from "@alpha-traders/contracts";

export type NativePushRegistrationStatus = "registered" | "denied" | "unavailable" | "failed";
export type PushSetupIssue = Extract<NativePushRegistrationStatus, "denied" | "failed">;

export function pushSetupIssueFromRegistrationStatus(
  status: NativePushRegistrationStatus,
): PushSetupIssue | null {
  return status === "denied" || status === "failed" ? status : null;
}

export function pushSetupRecoveryCopy(locale: MobileLocale, issue: PushSetupIssue) {
  if (locale === "ar") {
    return issue === "denied"
      ? {
          title: "إشعارات الهاتف متوقفة",
          body: "فعّل إشعارات Alpha Traders من إعدادات الهاتف حتى لا تفوّت رسائل غرفة التداول أو الخطوات المطلوبة.",
          action: "فتح الإعدادات",
          dismiss: "لاحقًا",
        }
      : {
          title: "تعذر تفعيل إشعارات الهاتف",
          body: "لم نتمكن من ربط هذا الجهاز بإشعارات شاشة القفل. تحقق من الإنترنت ثم حاول مرة أخرى.",
          action: "إعادة المحاولة",
          dismiss: "لاحقًا",
        };
  }

  return issue === "denied"
    ? {
        title: "Phone notifications are off",
        body: "Enable Alpha Traders notifications in phone settings so you do not miss Trade Room messages or required steps.",
        action: "Open settings",
        dismiss: "Later",
      }
    : {
        title: "Phone notifications need attention",
        body: "We could not connect this device for lock-screen alerts. Check your internet connection and try again.",
        action: "Try again",
        dismiss: "Later",
      };
}
