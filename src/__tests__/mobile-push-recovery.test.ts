// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  pushSetupIssueFromRegistrationStatus,
  pushSetupRecoveryCopy,
} from "../../apps/mobile/src/notifications/push-registration-recovery";

describe("native push registration recovery", () => {
  it("surfaces only actionable signed-device failures", () => {
    expect(pushSetupIssueFromRegistrationStatus("registered")).toBeNull();
    expect(pushSetupIssueFromRegistrationStatus("unavailable")).toBeNull();
    expect(pushSetupIssueFromRegistrationStatus("denied")).toBe("denied");
    expect(pushSetupIssueFromRegistrationStatus("failed")).toBe("failed");
  });

  it("gives denied users bilingual phone-settings guidance", () => {
    expect(pushSetupRecoveryCopy("en", "denied")).toMatchObject({
      title: "Phone notifications are off",
      action: "Open settings",
    });
    expect(pushSetupRecoveryCopy("ar", "denied")).toMatchObject({
      title: "إشعارات الهاتف متوقفة",
      action: "فتح الإعدادات",
    });
  });

  it("gives transient failures a retry action instead of settings guidance", () => {
    expect(pushSetupRecoveryCopy("en", "failed").action).toBe("Try again");
    expect(pushSetupRecoveryCopy("ar", "failed").action).toBe("إعادة المحاولة");
  });
});
