import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import { FreeCourseAccessNote, FreeCourseEntryLink, FreeCourseSetupSteps } from "./free-course-entry";

const session = vi.hoisted(() => ({ user: null as { role: string; roles: string[]; sellerStatus: string; emailVerified?: boolean } | null }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => ({ user: session.user }) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname: string; query: Record<string, string> } }) =>
    <a href={typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`} {...props}>{children}</a>,
}));

function Entry({ locale }: { locale: "ar" | "en" }) {
  return <><FreeCourseEntryLink locale={locale} /><FreeCourseAccessNote locale={locale} /><FreeCourseSetupSteps locale={locale} /></>;
}
beforeEach(() => { session.user = null; });

describe("session-aware free course entry", () => {
  it.each(["ar", "en"] as const)("preserves %s Academy intent for anonymous visitors", locale => {
    render(<Entry locale={locale} />);
    const href = screen.getByRole("link").getAttribute("href")!;
    expect(href).toContain("/login?");
    expect(new URL(href, "https://example.test").searchParams.get("redirectTo")).toBe(`/${locale}/academy`);
    expect(screen.getByText(locale === "ar" ? /أنشئ حسابًا أو سجّل الدخول/ : /Create an account or sign in/)).toBeTruthy();
  });

  it.each(["guest", "student", "buyer", "approved_seller", "admin", "owner"])("opens the Academy directly for a signed-in %s", role => {
    session.user = { role, roles: [role], sellerStatus: "buyer", emailVerified: true };
    render(<Entry locale="en" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/academy");
    expect(screen.queryByText(/Create an account or sign in/)).toBeNull();
    expect(screen.queryByText(/2\. Create an account/)).toBeNull();
    expect(screen.getByText(/Your account is ready/)).toBeTruthy();
  });

  it("updates course entry immediately after a student signs out", () => {
    session.user = { role: "student", roles: ["student"], sellerStatus: "buyer", emailVerified: true };
    const page = render(<Entry locale="ar" />);
    expect(screen.getByRole("link", { name: "تابع الدورة المجانية" }).getAttribute("href")).toBe("/academy");
    session.user = null;
    page.rerender(<Entry locale="ar" />);
    expect(screen.getByRole("link", { name: "ابدأ الدورة المجانية" }).getAttribute("href")).toContain("/login?");
    expect(screen.queryByText(/حسابك جاهز/)).toBeNull();
  });

  it("requests only email verification from an already registered unverified account", () => {
    session.user = { role: "guest", roles: ["guest"], sellerStatus: "buyer", emailVerified: false };
    render(<Entry locale="en" />);
    expect(screen.getByText(/^Verify your email to access lessons/)).toBeTruthy();
    expect(screen.queryByText(/Create an account or sign in/)).toBeNull();
  });
});
