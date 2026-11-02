import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MentorshipLink } from "./mentorship-link";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => router,
  Link: ({ href, children, onNavigate, replace }: {
    href: string; children: React.ReactNode; replace: boolean;
    onNavigate: (event: { preventDefault: () => void }) => void;
  }) => <a href={href} data-replace={replace} onClick={e => { onNavigate(e); e.preventDefault(); }}>{children}</a>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("accepts one navigation before a render, then allows a later attempt", () => {
  render(<MentorshipLink href="/learn-with-mark" locale="ar" className="cta">Course</MentorshipLink>);
  const link = screen.getByRole("link");
  act(() => { for (let i = 0; i < 24; i++) link.click(); });
  expect(router.push).toHaveBeenCalledExactlyOnceWith("/learn-with-mark", { locale: "ar" });
  fireEvent.click(link);
  expect(router.push).toHaveBeenCalledTimes(2);
});

it("leaves same-page disclosure to the link with replacement history", () => {
  render(<MentorshipLink href="/mentorship-offer#offer-details" locale="en" className="cta" replace>Offer</MentorshipLink>);
  const link = screen.getByRole("link");
  expect(link.getAttribute("data-replace")).toBe("true");
  fireEvent.click(link);
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});
