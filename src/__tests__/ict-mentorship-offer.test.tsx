import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { isIctMentorshipIntakeOpen } from "@/lib/ict-mentorship-offer";
import { learningInformationReply } from "@/lib/learning-interest";

vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: async () => ({ id: "signed-in-learner" }) }));
import MentorshipPage from "@/app/[locale]/learn-with-mark/page";

afterEach(() => { vi.restoreAllMocks(); });

it("uses the actual end of 2026 in Israel with no overlapping open/closed period", () => {
  expect(isIctMentorshipIntakeOpen(Date.parse("2026-12-31T21:59:59.999Z"))).toBe(true);
  expect(isIctMentorshipIntakeOpen(Date.parse("2026-12-31T22:00:00.000Z"))).toBe(false);
});

it.each(["en", "ar"] as const)("closes the %s member form and reply after the deadline while retaining free learning", async locale => {
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
  const rendered = new DOMParser().parseFromString(html, "text/html");
  expect(Array.from(rendered.querySelectorAll("dd .currency-money[dir=ltr]"), (price) => price.textContent)).toEqual(["₪6,700", "₪7,500"]);
  expect(html).not.toMatch(/₪6,?500/);
});

it.each(["en", "ar"] as const)("keeps the %s tuition, FAQ and enquiry reply in sync across the November deadline", async locale => {
  const now = vi.spyOn(Date, "now");
  now.mockReturnValue(Date.parse("2026-11-30T21:59:59.999Z"));
  const page = () => MentorshipPage({ params: Promise.resolve({ locale }) }).then(renderToStaticMarkup);
  const november = new DOMParser().parseFromString(await page(), "text/html");
  expect(Array.from(november.querySelectorAll("dd .currency-money"), el => el.textContent)).toEqual(["₪6,030", "₪6,750"]);
  expect(november.querySelector("#faq")?.textContent).toContain("₪6,030");
  expect(learningInformationReply(locale)).toContain("₪6,750");
  now.mockReturnValue(Date.parse("2026-11-30T22:00:00.000Z"));
  const december = await page();
  const increase = locale === "ar" ? "بنسبة 10% على الأقل" : "at least 10%";
  expect(december).toContain(increase);
  expect(december).toContain('name="experience"');
  expect(december).not.toMatch(/6,030|6,750|6,700|7,500/);
  expect(learningInformationReply(locale)).toContain(increase);
});
