import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("native Academy shell", () => {
  it("keeps five primary tabs and moves the approved-seller workspace into Profile", () => {
    const tabs = source("apps/mobile/app/(tabs)/_layout.tsx");
    const profile = source("apps/mobile/app/(tabs)/profile.tsx");

    expect(tabs).toContain('name="academy"');
    expect(tabs).toContain('<Tabs.Screen name="seller" options={{ href: null }} />');
    expect(profile).toContain('router.push("/(tabs)/seller")');
    expect(profile).toContain('t("openNativeSellerWorkspace")');
  });

  it("uses full native lesson controls with accessible touch targets and no WebView", () => {
    const lesson = source("apps/mobile/src/screens/academy-lesson-screen.tsx");
    const quiz = source("apps/mobile/src/academy/academy-quiz.tsx");

    expect(lesson).toContain("<ScrollView");
    expect(lesson).toContain("<AcademyQuiz");
    expect(lesson).toContain('accessibilityRole="link"');
    expect(lesson).not.toContain("WebView");
    expect(quiz).toContain('accessibilityRole="radio"');
    expect(quiz).toContain("minHeight: 54");
  });

  it("loads the account-scoped Academy cache immediately in offline mode", () => {
    const hook = source("apps/mobile/src/academy/use-academy.ts");
    const cache = source("apps/mobile/src/academy/academy-content-cache.ts");

    expect(hook).toContain('networkMode: "always"');
    expect(hook).toContain("isOnline");
    expect(cache).toContain("isOnline === false");
    expect(cache).toContain("catalogKey(userId)");
    expect(cache).toContain("lessonKey(userId, slug)");
  });
});
