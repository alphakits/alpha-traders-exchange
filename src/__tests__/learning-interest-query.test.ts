import { expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: vi.fn() }));
import { LEARNING_INTEREST_QUERY } from "@/lib/learning-interest-store";
import { LEARNING_INTEREST_SUBJECT } from "@/lib/learning-interest";

it("counts the latest enquiry per normalized email, preserving aliases and excluding spam and unrelated messages", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.contact_submissions (id text, name text, email text, message text, created_at timestamptz, subject text, status text, campaign_link_id text)");
    for (const row of [
      ["1", "One", "Learner@example.test", "old", "2026-09-26T00:00:00Z", LEARNING_INTEREST_SUBJECT.en, "new"],
      ["2", "One", " learner@example.test ", "latest", "2026-09-27T00:00:00Z", LEARNING_INTEREST_SUBJECT.ar, "new"],
      ["3", "Alias", "learner+course@example.test", "alias", "2026-09-27T01:00:00Z", LEARNING_INTEREST_SUBJECT.en, "new"],
      ["4", "Spam", "spam@example.test", "spam", "2026-09-27T02:00:00Z", LEARNING_INTEREST_SUBJECT.en, "spam"],
      ["5", "Private support", "support@example.test", "unrelated", "2026-09-27T03:00:00Z", "Help", "new"],
    ]) await db.query("INSERT INTO public.contact_submissions (id,name,email,message,created_at,subject,status) VALUES ($1,$2,$3,$4,$5,$6,$7)", row);
    const result = await db.query<{ id: string; total: number }>(LEARNING_INTEREST_QUERY, [Object.values(LEARNING_INTEREST_SUBJECT)]);
    expect(result.rows.map(row => row.id)).toEqual(["3", "2"]);
    expect(result.rows.map(row => row.total)).toEqual([2, 2]);
  } finally { await db.close(); }
}, 30000);
