import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";

const mocks = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUserForAuthorization: mocks.user }));
vi.mock("@/lib/learning-interest-store", () => ({ readLearningInterests: mocks.read }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));

import Inbox, { generateMetadata } from "@/app/[locale]/admin/learning-interest/page";

const props = () => ({ params: Promise.resolve({ locale: "ar" }) });
describe("owner learning-interest privacy", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue([]); });

  it.each([null, { role: "buyer" }, { role: "approved_seller" }, { role: "admin" }, { role: "owner", disabled: true }])("does not read enquiries for a missing, non-owner or disabled session: %j", async user => {
    mocks.user.mockResolvedValue(user);
    await expect(Inbox(props())).rejects.toThrow("REDIRECT:");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("reads enquiries for the authenticated owner and escapes submitted content", async () => {
    mocks.user.mockResolvedValue({ role: "owner", roles: ["owner"] });
    mocks.read.mockResolvedValue([{ id: "test", name: "<script>alert(1)</script>", email: "learner@example.test", message: "I want to learn risk management.", created_at: "2026-09-27T00:00:00Z", total: 1 }]);
    const html = renderToStaticMarkup(await Inbox(props()));
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(html).toContain("learner@example.test");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("does not present a database outage as an empty list", async () => {
    mocks.user.mockResolvedValue({ role: "owner" });
    mocks.read.mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await Inbox(props()));
    expect(html).toContain("تعذّر تحميل الطلبات");
    expect(html).not.toContain("لا توجد طلبات اهتمام محفوظة بعد");
  });

  it("keeps the inbox out of search", async () => {
    const metadata = await generateMetadata(props());
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
