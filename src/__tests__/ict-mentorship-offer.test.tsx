import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { isIctMentorshipIntakeOpen } from "@/lib/ict-mentorship-offer";
import { learningInformationReply } from "@/lib/learning-interest";

vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
import MentorshipPage from "@/app/[locale]/learn-with-mark/page";

afterEach(() => { vi.restoreAllMocks(); });

it("uses the actual end of 2026 in Israel with no overlapping open/closed period", () => {
  expect(isIctMentorshipIntakeOpen(Date.parse("2026-12-31T21:59:59.999Z"))).toBe(true);
  expect(isIctMentorshipIntakeOpen(Date.parse("2026-12-31T22:00:00.000Z"))).toBe(false);
});

it.each(["en", "ar"] as const)("closes the %s public form and reply after the deadline while retaining free learning", async locale => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-01T00:00:00Z"));
  const html = renderToStaticMarkup(await MentorshipPage({ params: Promise.resolve({ locale }) }));
  expect(html).not.toContain('name="experience"');
  expect(html).not.toContain('href="#interest"');
  expect(html).toContain("/learn-trading-free");
  const reply = learningInformationReply(locale);
  expect(reply).toContain(`/${locale}/learn-trading-free`);
  expect(reply).not.toContain("₪6,700");
});

it.each(["en", "ar"] as const)("shows one programme and the confirmed %s starting-point fees during the window", async locale => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-27T11:00:00Z"));
  const html = renderToStaticMarkup(await MentorshipPage({ params: Promise.resolve({ locale }) }));
  expect(html).toContain('name="experience"');
  expect(html).toContain("₪6,700");
  expect(html).toContain("₪7,500");
  expect(html).not.toMatch(/₪6,?500/);
});
