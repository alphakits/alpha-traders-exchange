import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";

const mocks = vi.hoisted(() => ({ pool: vi.fn(), owner: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: mocks.pool }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUserForAuthorization: mocks.owner }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));

import { POST } from "@/app/api/contact/route";
import Inbox from "@/app/[locale]/admin/learning-interest/page";
import { readLearningInterests } from "@/lib/learning-interest-store";

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-27T11:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); });

it("persists a campaign enquiry through the API and displays it only to the owner; RLS denies client roles", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.contact_submissions (id bigint GENERATED ALWAYS AS IDENTITY, name text, email text, subject text, message text, locale text, ip_hash text, status text DEFAULT 'new', created_at timestamptz DEFAULT now())`);
    const migration = readFileSync("supabase/migrations/20260927004759_learning_campaign_attribution.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration); // Safe to retry the expand-only migration.
    mocks.pool.mockReturnValue({ query: (sql: string, values?: unknown[]) => db.query(sql, values) });
    const response = await POST(new NextRequest("http://localhost/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Test Learner", email: "learner@example.test", subject: "Learning", message: "I want to understand risk management.", locale: "en", topic: "learning-with-mark", campaignLinkId: "ig_m01", learningDetails: { experience: "studied", availability: "  3 hours, evenings  " } }) }));
    expect(response.status).toBe(200);
    const rows = await readLearningInterests();
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_link_id).toBe("ig_m01");
    mocks.owner.mockResolvedValue({ role: "owner" });
    const html = renderToStaticMarkup(await Inbox({ params: Promise.resolve({ locale: "en" }) }));
    expect(html).toContain("learner@example.test");
    expect(html).toContain("Campaign link:");
    expect(html).toContain("instagram · organic_social · m01");
    expect(html).toContain("Studied before; need help applying it");
    expect(html).toContain("Available study time: 3 hours, evenings");
    expect(html).toContain("I want to understand risk management.");
    expect(html).toContain("Ready reply for ICT Mentorship information");
    mocks.owner.mockResolvedValue({ role: "admin" });
    await expect(Inbox({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:");
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; GRANT USAGE ON SCHEMA public TO anon, authenticated; GRANT SELECT, INSERT ON public.contact_submissions TO anon, authenticated;");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      expect((await db.query("SELECT campaign_link_id FROM public.contact_submissions")).rows).toHaveLength(0);
      await expect(db.query("INSERT INTO public.contact_submissions(name,campaign_link_id) VALUES ('Denied','ig_m01')")).rejects.toThrow(/row-level security|permission denied/i);
      await db.exec("RESET ROLE");
    }
  } finally { await db.close(); }
}, 30000);
